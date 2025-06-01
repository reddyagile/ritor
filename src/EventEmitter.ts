class EventEmitter {
  public eventMap = new Map();
  constructor() {}

  public on(event: string, callback: Function) {
    if (!this.eventMap.has(event)) {
      this.eventMap.set(event, new Set());
    }
    this.eventMap.get(event).add(callback);
  }

  public off(event: string, callback: Function) {
    if (this.eventMap.has(event)) {
      const callbacks = this.eventMap.get(event);
      if (callbacks.has(callback)) {
        callbacks.delete(callback);
      }
    }
  }

  public emit<T>(event: string, ...data: T[]) {
    if (this.eventMap.has(event)) {
      this.eventMap.get(event).forEach((callback: Function) => {
        setTimeout(() => callback(...data), 0);
      });
    }
  }
}

export default EventEmitter;
