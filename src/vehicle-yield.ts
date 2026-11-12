const completed = Promise.resolve();
let channel: MessageChannel | undefined;
const queued: (() => void)[] = [];
type IdlePort = MessagePort & {ref?: () => void; unref?: () => void};

function yieldTask(): Promise<void> {
  // An ordinary posted task gives input, animation and timers a turn without
  // boosting adaptation work ahead of other page tasks. Reuse one channel.
  // It also avoids the nested setTimeout minimum delay during large models.
  if (typeof MessageChannel !== 'undefined') {
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => {
        queued.shift()?.();
        if (!queued.length) {
          // Node also exposes MessageChannel; idle ports must not keep tests
          // alive. Browsers do not expose these optional lifecycle methods.
          (channel!.port1 as IdlePort).unref?.(); (channel!.port2 as IdlePort).unref?.();
        }
      };
    }
    return new Promise<void>(resolve => {
      queued.push(resolve);
      (channel!.port1 as IdlePort).ref?.(); (channel!.port2 as IdlePort).ref?.();
      channel!.port2.postMessage(null);
    });
  }
  const scheduler = (globalThis as typeof globalThis & {scheduler?: {yield?: () => Promise<void>}}).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Share one small main-thread work budget across the steps of an adaptation. */
export function createVehicleYield(signal?: AbortSignal): () => Promise<void> {
  let deadline = performance.now() + 8;
  return () => {
    signal?.throwIfAborted();
    if (performance.now() < deadline) return completed;
    // A resolved Promise alone does not let input or animation frames run.
    return yieldTask().then(() => {
      signal?.throwIfAborted();
      deadline = performance.now() + 8;
    });
  };
}
