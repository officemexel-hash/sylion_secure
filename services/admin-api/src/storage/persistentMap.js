export class PersistentMap extends Map {
  constructor({ store = null, collection }) {
    super();
    this.store = store;
    this.collection = collection;
    if (store) {
      const entries =
        typeof store.listEntries === "function"
          ? store.listEntries(collection)
          : store.list(collection).map((item) => ({ key: item.id, value: item }));
      for (const item of entries) {
        super.set(item.key, item.value);
      }
    }
  }

  set(key, value) {
    super.set(key, value);
    if (this.store) {
      this.store.save(this.collection, key, value);
    }
    return this;
  }

  delete(key) {
    const result = super.delete(key);
    if (this.store) {
      this.store.delete(this.collection, key);
    }
    return result;
  }
}
