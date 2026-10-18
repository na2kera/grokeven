import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { initGlasses, handleInput, refresh, dispose } from './glasses/app.ts'
import { resolveEventType } from './events.ts'
import { initSettingsStore } from './store/settings.ts'
import { mountPhoneUI } from './phone/ui.ts'

const bridge = await waitForEvenAppBridge()

await initSettingsStore(bridge)
mountPhoneUI(document.querySelector<HTMLDivElement>('#app')!)
await initGlasses(bridge)

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  dispose()
  unsubscribe()
}

const unsubscribe = bridge.onEvenHubEvent(event => {
  const eventType = resolveEventType(event)
  if (eventType === null) return
  if (eventType === OsEventTypeList.SYSTEM_EXIT_EVENT || eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
    return
  }
  if (eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    refresh()
    return
  }
  handleInput(eventType)
})

window.addEventListener('beforeunload', cleanup)
