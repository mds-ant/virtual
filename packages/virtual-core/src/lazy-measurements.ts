// Lazy materialization for the lanes===1 fast path. Backed by a
// Float64Array (stride 2: start, size, …); VirtualItems are constructed on
// first indexed read and cached. Saves the per-item object allocation at
// large list counts where most items are never visible.

import type { VirtualItem } from './index'

type Key = number | string | bigint

export function createLazyMeasurementsView(
  count: number,
  flat: Float64Array,
  getItemKey: (i: number) => Key,
): Array<VirtualItem> {
  const cache: Array<VirtualItem | undefined> = new Array(count)

  // In-range canonical integer index for `prop`, or -1. Digit-only scan —
  // rejects `"01"`, `"1e2"`, `"0x10"` — so existence checks (`has`,
  // `getOwnPropertyDescriptor`) agree with the keys `ownKeys` reports,
  // exactly as on a real dense array.
  const toIndex = (prop: string | symbol): number => {
    if (typeof prop !== 'string' || prop.length === 0) {
      return -1
    }
    const c0 = prop.charCodeAt(0)
    if (c0 < 48 || c0 > 57) {
      return -1
    }
    if (c0 === 48) {
      return prop.length === 1 && count > 0 ? 0 : -1
    }
    let i = c0 - 48
    for (let k = 1; k < prop.length; k++) {
      const c = prop.charCodeAt(k)
      if (c < 48 || c > 57) {
        return -1
      }
      i = i * 10 + (c - 48)
    }
    return i < count ? i : -1
  }

  const materialize = (i: number): VirtualItem => {
    let v = cache[i]
    if (!v) {
      const s = flat[i * 2]!
      v = cache[i] = {
        index: i,
        key: getItemKey(i),
        start: s,
        size: flat[i * 2 + 1]!,
        end: s + flat[i * 2 + 1]!,
        lane: 0,
      }
    }
    return v
  }

  // The traps beyond `get` uphold the Array contract: the backing target is
  // mostly holes, but the view must present a dense array. Without `has`,
  // HasProperty-based operations (`slice`, `map`, `filter`, `forEach`,
  // `indexOf`, `concat`, …) consult the holey target and silently treat
  // unmaterialized items as absent — a copy keeps `length` but carries
  // holes. `getOwnPropertyDescriptor` and `ownKeys` extend the guarantee to
  // `Object.keys`, object spread, and `for…in` (enumeration materializes
  // every item — O(count), the price of the dense contract), and
  // `preventExtensions` materializes everything up front so `Object.freeze`
  // and `Object.seal` behave exactly as on a dense array. The target is an
  // ordinary extensible array, so the Proxy invariants hold; `ownKeys`
  // still appends the target's own non-index keys, keeping the
  // non-configurable `length` in the result.
  return new Proxy(cache as any, {
    get(target, prop, receiver) {
      const i = toIndex(prop)
      if (i !== -1) {
        return materialize(i)
      }
      if (prop === 'length') {
        return count
      }
      return Reflect.get(target, prop, receiver)
    },
    has(target, prop) {
      if (toIndex(prop) !== -1) {
        return true
      }
      return Reflect.has(target, prop)
    },
    getOwnPropertyDescriptor(target, prop) {
      const i = toIndex(prop)
      if (i !== -1) {
        materialize(i)
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
    ownKeys(target) {
      const keys: Array<string | symbol> = []
      for (let i = 0; i < count; i++) {
        keys.push(String(i))
      }
      for (const k of Reflect.ownKeys(target)) {
        if (toIndex(k) === -1) {
          keys.push(k)
        }
      }
      return keys
    },
    preventExtensions(target) {
      for (let i = 0; i < count; i++) {
        materialize(i)
      }
      return Reflect.preventExtensions(target)
    },
  }) as Array<VirtualItem>
}
