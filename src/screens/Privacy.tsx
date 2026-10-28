import Screen from './Screen'

const heading = 'text-highlight text-xs font-bold tracking-[0.16em] uppercase'

// DRAFT — the owner approves the final wording before launch. Bracketed items are still to fill in.
export default function Privacy() {
  return (
    <Screen title="Privacy" back="#/">
      <p className="text-muted-foreground text-sm">Last updated [date of launch]</p>
      <p>
        Meal Planner helps your household plan meals and shop for them. This page explains, in plain
        language, what we keep about you, why, and how to delete it.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className={heading}>What we keep</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your email address, so you can sign in with an emailed link.</li>
          <li>Your household's name and the people in it.</li>
          <li>The recipes, meal plans and shopping lists your household adds.</li>
          <li>
            Captions, web addresses and screenshots you choose to import, while we turn them into a
            recipe.
          </li>
          <li>A count of how many imports your household runs each day, to keep costs fair.</li>
        </ul>
        <p>
          We don't use advertising or tracking, and we never sell your information. Everything your
          household adds is visible only to the people in your household.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={heading}>Who helps us run it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase stores your account and household data ([data location]).</li>
          <li>Netlify serves the website.</li>
          <li>
            Anthropic (Claude) reads the caption, web page or screenshots you import and sends back
            the recipe. Anthropic doesn't use this to train its models.
          </li>
          <li>[Email provider] sends your sign-in links.</li>
        </ul>
        <p>Some of these companies are based overseas, so your information may be stored there.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={heading}>Deleting your account</h2>
        <p>
          Go to Settings and choose Delete my account. We remove your account straight away. If
          nobody else is in your household, its recipes, plans, lists and screenshots go too. If
          others share your household, it stays for them, along with the recipes and items you
          added.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={heading}>Questions</h2>
        <p>
          To ask what we hold about you, have it corrected, or make a complaint, email [contact
          email]. We handle personal information in line with the Australian Privacy Principles.
        </p>
      </section>
    </Screen>
  )
}
