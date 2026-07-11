import 'fake-indexeddb/auto';

if (typeof globalThis.crypto.randomUUID !== 'function') {
  throw new Error('Tests require crypto.randomUUID.');
}
