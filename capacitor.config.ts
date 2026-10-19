import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jrvsolutions.mealplanner',
  appName: 'Meal Planner',
  webDir: 'dist',
  plugins: {
    // Same App Group as ios/App/ShareExtension (share sheet → import screen).
    CapacitorShareTarget: { appGroupId: 'group.com.jrvsolutions.mealplanner' },
  },
}

export default config
