import UIKit
import UniformTypeIdentifiers

// Share sheet → Meal Planner. Copies shared images into the App Group, saves links/text and the
// image list where @capgo/capacitor-share-target looks for them, then opens the app. If the app
// can't be opened from here, the plugin picks the share up next time the app becomes active.
class ShareViewController: UIViewController {
    private let appGroupId = "group.com.jrvsolutions.mealplanner" // same as capacitor.config.ts
    private let maxImages = 5

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handleShare() }
    }

    private func handleShare() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        var texts: [String] = []
        var files: [[String: String]] = []
        // Earlier shares have been read by the app by now; don't let copies pile up.
        if let old = sharedFolder() { try? FileManager.default.removeItem(at: old) }

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier), files.count < maxImages {
                if let file = await copyImage(provider) { files.append(file) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                      let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                texts.append(url.absoluteString)
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                texts.append(text)
            }
        }

        UserDefaults(suiteName: appGroupId)?.set(
            ["title": "", "texts": texts, "files": files], forKey: "share-target-data")
        openApp(URL(string: "mealplanner://share")!)
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func sharedFolder() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent("shared", isDirectory: true)
    }

    // The shared file is only readable during this call, so copy it into the shared container.
    private func copyImage(_ provider: NSItemProvider) async -> [String: String]? {
        guard let container = sharedFolder() else { return nil }
        try? FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)

        return await withCheckedContinuation { done in
            _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                guard let url else { return done.resume(returning: nil) }
                let type = UTType(filenameExtension: url.pathExtension) ?? .jpeg
                let dest = container.appendingPathComponent("\(UUID().uuidString).\(url.pathExtension)")
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    done.resume(returning: [
                        "uri": dest.absoluteString,
                        "name": url.lastPathComponent,
                        "mimeType": type.preferredMIMEType ?? "image/jpeg",
                    ])
                } catch {
                    done.resume(returning: nil)
                }
            }
        }
    }

    // Extensions can't call UIApplication.open directly; reach it through the responder chain.
    private func openApp(_ url: URL) {
        var responder: UIResponder? = self
        while let current = responder {
            if let app = current as? UIApplication {
                app.open(url)
                return
            }
            responder = current.next
        }
    }
}
