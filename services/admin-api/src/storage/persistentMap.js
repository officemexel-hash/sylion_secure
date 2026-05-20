export class PersistentMap extends Map {
  constructor({ store = null, collection }) {
    super();
    this.store = store;
    this.collection = collection;
    if (store) {
      for (const item of store.list(collection)) {
        super.set(item.id, item);
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

