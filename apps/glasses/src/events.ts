import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'

// protobuf elides default-valued fields and CLICK_EVENT = 0 is the enum default,
// so a present channel with no eventType IS a click (same idiom as navigateven).
function channelEventType(
  channel: { eventType?: OsEventTypeList } | undefined,
): OsEventTypeList | null {
  if (!channel) return null
  return channel.eventType ?? OsEventTypeList.CLICK_EVENT
}

export function resolveEventType(event: EvenHubEvent): OsEventTypeList | null {
  return (
    channelEventType(event.sysEvent) ??
    channelEventType(event.textEvent) ??
    channelEventType(event.listEvent)
  )
}
