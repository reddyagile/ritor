class EventEmitter {
  public eventMap = new Map();
  constructor() {}

  public on(event: string, callback: Function) {
    if (!this.eventMap.has(event)) {
      this.eventMap.set(event, []);
    }
    this.eventMap.get(event).push(callback);
  }

  public off(event: string, callback: Function) {
    if (this.eventMap.has(event)) {
      const callbacks = this.eventMap.get(event).filter((cb: Function) => cb !== callback);
      this.eventMap.set(event, callbacks);
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
