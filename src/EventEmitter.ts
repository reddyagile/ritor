// src/EventEmitter.ts
class EventEmitter {
  public eventMap = new Map<string, Set<Function>>(); // Explicitly type Map value
  constructor() {}

  public on(event: string, callback: Function) {
    if (!this.eventMap.has(event)) {
      this.eventMap.set(event, new Set<Function>()); // Explicitly type Set
    }
    const callbacks = this.eventMap.get(event);
    if (callbacks) { // Check if callbacks set exists
        callbacks.add(callback);
    }
  }

  // Changed callback to be optional
  public off(event: string, callback?: Function) {
    if (this.eventMap.has(event)) {
      if (callback) { // If a specific callback is provided, remove only that one
        const callbacks = this.eventMap.get(event);
        if (callbacks && callbacks.has(callback)) {
          callbacks.delete(callback);
          if (callbacks.size === 0) { // Optional: remove event entry if no listeners left
            this.eventMap.delete(event);
          }
        }
      } else { // If no callback is provided, remove all listeners for the event
        this.eventMap.delete(event);
      }
    }
  }

  // Changed generic <T> and T[] to any[] for data
  public emit(event: string, ...data: any[]) {
    if (this.eventMap.has(event)) {
      const callbacks = this.eventMap.get(event);
      if (callbacks) { // Check if callbacks set exists
          callbacks.forEach((cb: Function) => {
            if (typeof cb === 'function') {
                cb(...data); // Synchronous call
            }
          });
      }
    }
  }
}

export default EventEmitter;
