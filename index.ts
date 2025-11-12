const hidden: unique symbol = Symbol('hidden');


function _isProxifiable(obj: any, classesToProxify: Function[]) {
  return !!obj && typeof obj === 'object' &&
  (
    obj.constructor === undefined ||
    obj.constructor === Object ||
    obj.constructor === Array ||
    classesToProxify.some(c => obj.constructor === c)
  );
}

function _getRecursivePropDescriptor(obj: any, prop: PropertyKey) {
  let desc = Object.getOwnPropertyDescriptor(obj, prop);
  while (!desc) {
    obj = Object.getPrototypeOf(obj);
    if (!obj) break;
    desc = Object.getOwnPropertyDescriptor(obj, prop);
  }
  return desc;
}

let _currentHandlersToBeCalled: Set<() => void> = new Set();
const _handlersToBeCalledStack: Set<() => void>[] = [];
let _handlersToBeCalledIndex = 0;

// To manage cyclic structures
const _changesCache: Map<any, boolean> = new Map();

function _setHandlersToBeCalled(obj: any, key: string | symbol | number) {
  let handlersSet = 0;
  if (obj[hidden].handlers[key]) {
    for (const handler of obj[hidden].handlers[key]) {
      _currentHandlersToBeCalled.add(handler);
      handlersSet++;
    }
  }
  return handlersSet;
}

function _markAllOwnAndDescendantHandlersToBeCalled(obj: any, classesToProxify: any[]) {
  if (!_isProxifiable(obj, classesToProxify)) return;

  if (_changesCache.has(obj)) {
    return;
  }

  _changesCache.set(obj, true);

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      _markAllOwnAndDescendantHandlersToBeCalled(obj[i], classesToProxify);
      _setHandlersToBeCalled(obj, i);
    }
  } else {
    const keys = [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertySymbols(obj)];
    for (let key of keys) {
      _markAllOwnAndDescendantHandlersToBeCalled(obj[key], classesToProxify);
      _setHandlersToBeCalled(obj, key);
    }
  }
}

const _ancestorCache: Map<any, boolean> = new Map();
function _markAncestorHandlersToBeCalled(obj: any) {
  if (!obj) return;

  if (_ancestorCache.has(obj)) {
    return !!_ancestorCache.get(obj);
  }

  _ancestorCache.set(obj, true);

  for (const parent of obj[hidden].parents) {
    if (Array.isArray(parent)) {
      for (let i = 0; i < parent.length; i++) {
        if (parent[i] === obj) {
          _setHandlersToBeCalled(parent, i);
        }
      }
    } else {
      const keys = [...Object.getOwnPropertyNames(parent), ...Object.getOwnPropertySymbols(parent)];
      for (let key of keys) {
        if (parent[key] === obj) {
          _setHandlersToBeCalled(parent, key);
        }
      }
    }
    _markAncestorHandlersToBeCalled(parent);
  }
}

// Recursively marks handlers that should be called (deep first)
// Returns true if handler of `obj` for `prop` should be called
function _markHandlersToBeCalled(obj: any, prop: string | symbol | number, newValue: any, classesToProxify: any[]) {
  const oldValue = obj[prop];

  if (_isProxifiable(oldValue, classesToProxify)) {

    if (_changesCache.has(oldValue)) {
      return !!_changesCache.get(oldValue);
    }

    if (_isProxifiable(newValue, classesToProxify)) {
      // Both values are proxifiable objects

      if (Array.isArray(oldValue) !== Array.isArray(newValue)) {
        // One is an array while the other isn't

        _markAllOwnAndDescendantHandlersToBeCalled(oldValue, classesToProxify);
        _setHandlersToBeCalled(obj, prop);
        return true;
      } else {
        // Compare their fields one by one

        _changesCache.set(oldValue, false);

        let valueChanged = false;

        // Iterate to mark and compare recursively
        if (Array.isArray(oldValue)) {
          for (let i = 0; i < oldValue.length; i++) {
            const changed = _markHandlersToBeCalled(oldValue, i, newValue[i], classesToProxify);
            valueChanged ||= changed;
          }

          for (let i = oldValue.length; i < newValue.length; i++) {
            _setHandlersToBeCalled(oldValue, i);
            valueChanged = true;
          }
          if (oldValue.length !== newValue.length) {
            _setHandlersToBeCalled(oldValue, 'length');
          }
        } else {
          const keys = [...Object.getOwnPropertyNames(oldValue), ...Object.getOwnPropertySymbols(oldValue)];
          let newKeys = [...Object.getOwnPropertyNames(newValue), ...Object.getOwnPropertySymbols(newValue)];
          for (let key of keys) {
            const i = newKeys.indexOf(key);
            if (i != -1) {
              newKeys.splice(i, 1);
            }
            const changed = _markHandlersToBeCalled(oldValue, key, newValue[key], classesToProxify);
            valueChanged ||= changed;
          }
          newKeys = newKeys.filter(k => newValue[k] !== undefined);

          for (let key of newKeys) {
            _setHandlersToBeCalled(oldValue, key);
            valueChanged = true;
          }
        }

        if (valueChanged) {
          _setHandlersToBeCalled(obj, prop);

          _changesCache.set(oldValue, true);
          return true;
        }

        _changesCache.set(oldValue, false);
        return false;
      }
    } else {
      _markAllOwnAndDescendantHandlersToBeCalled(oldValue, classesToProxify);
      _setHandlersToBeCalled(obj, prop);

      _changesCache.set(oldValue, true);
      return true;
    }
  } else {
    if (oldValue !== newValue) {
      _setHandlersToBeCalled(obj, prop);
      return true;
    } else {
      return false;
    }
  }
}

class InfiniteLoopError extends Error {}

// To prevent infinite loops
const handlerCallStack: any[] = [];
function _callHandlers() {
  // Store set of handlers we're about to call
  const htbc = _currentHandlersToBeCalled;

  // Prepare new set of handlers to call in case state changes within current handlers
  _handlersToBeCalledIndex++;
  _currentHandlersToBeCalled = _handlersToBeCalledStack[_handlersToBeCalledIndex] || new Set();
  _handlersToBeCalledStack[_handlersToBeCalledIndex] = _currentHandlersToBeCalled;
  for (const handler of htbc) {
    try {
      if (handlerCallStack.some(h => h.original === (handler as any).original)) {
        throw new InfiniteLoopError("Congrats genius, you created an infinite loop.");
      }

      handlerCallStack.push(handler);
      handler();
    } catch (e) {
      if (e instanceof InfiniteLoopError) {
        // Handlers will stop due to error, return to previous set of handlers
        _handlersToBeCalledIndex--;
        _currentHandlersToBeCalled = htbc;
        htbc.clear();

        throw e;
      } else {
        console.error(e);
      }
    } finally {
      handlerCallStack.pop();
    }
  }
  // Handlers completed, return to previous set of handlers
  _handlersToBeCalledIndex--;
  _currentHandlersToBeCalled = htbc;
  htbc.clear();
}

function _resubscribeHandlersRecursive(obj: any, classesToProxify: any[], cache: Set<any>) {
  cache.add(obj);

  // First resubscribe handlers of children
  for (const prop of [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertySymbols(obj)]) {
    if (_isProxifiable(obj[prop], classesToProxify) && !cache.has(obj[prop])) {
      _resubscribeHandlersRecursive(obj[prop], classesToProxify, cache);
    }
  }

  // Then resubscribe own handlers
  const h = obj[hidden].handlers;
  for (const prop of [...Object.getOwnPropertyNames(h), ...Object.getOwnPropertySymbols(h)]) {
    for (const handler of [...h[prop]]) {
      handler.update();
    }
  }
}

let _lastValidProxy: any = null;
let _lastProp: any = '';

function _proxifyInternal(obj: any, parent: object | null, classesToProxify: any[]) {
  if (obj[hidden]) {
    if (parent) {
      obj[hidden].parents.push(parent);
      obj[hidden].parents = [...new Set(obj[hidden].parents)];
    }
    return obj;
  }
  obj[hidden] = {
    parents: [],
    original: obj,
    handlers: {}
  };
  if (Array.isArray(obj)) {
    obj[hidden as any].length = obj.length;
  }
  if (parent) {
    obj[hidden].parents.push(parent);
    obj[hidden].parents = [...new Set(obj[hidden].parents)];
  }

  const p = new Proxy(
    obj,
    {
      // getPrototypeOf: (target) => {
      //   return Object.getPrototypeOf(target);
      // }
      set: (target, p, newValue, receiver) => {
        const oldValue = target[p];

        const isOldValueProxified = _isProxifiable(oldValue, classesToProxify) && oldValue[hidden];

        if (_isProxifiable(newValue, classesToProxify)) {
          newValue = _proxifyInternal(newValue, receiver, classesToProxify);
        }

        const markedAny = _markHandlersToBeCalled(receiver, p, newValue, classesToProxify);

        try {
          if (p === hidden) {
            return Reflect.set(target, p, newValue, receiver);
          }
          const d = _getRecursivePropDescriptor(receiver, p)
          if (d && (d.set || d.get)) {
            // TODO: setters can have side effects, like calmped values etc
            // In these cases a new value that is different from the old one
            // could result in no change in the actual value the accessor uses.
            // This is, as of yet, not taken into account here and as long as
            // the old value is different than the new one, callbacks are called.
            // The reason is that the aforementioned side effects can be very
            // extreme. For example a setter have take an object and mutate
            // its internal value instead of replacing it, which could make
            // any kind of comparison after it has been called pointless
            // unless the old value was deep copied (an expensive operation).
            // Leaving this here as a reminder in case I decide to try
            // solving this in the future.

            // If property is an accessor property, don't proxify.
            // Only data properties should proxify.
            return Reflect.set(target, p, newValue, receiver);
          }

          if (isOldValueProxified) {
            oldValue[hidden].parents = oldValue[hidden].parents.filter((p: any) => p !== receiver);
          }

          // To understand receiver:
          // https://stackoverflow.com/a/78454718
          // Basically if receiver isn't used setters and getters don't trap the members they use.
          return Reflect.set(target, p, newValue, receiver);
        } finally {
          // Mark length here if it changed
          if (Array.isArray(target)) {
            if (p !== "length") {
              if (target[hidden as any].length !== target.length) {
                _setHandlersToBeCalled(target, 'length');
              }
            }
            target[hidden as any].length = target.length;
          }

          if (markedAny) {
            _markAncestorHandlersToBeCalled(receiver);
          }
          _changesCache.clear();
          _ancestorCache.clear();

          _callHandlers();

          // Finally, migrate remaining handlers from old to new
          // Do it here after calling all the handlers so the
          // ones that got called by the changes have already
          // set themselves
          if (isOldValueProxified) {
            _resubscribeHandlersRecursive(oldValue, classesToProxify, new Set());
          }
        }
      },
      get: (target, p, receiver) => {
        _lastValidProxy = receiver;
        _lastProp = p;
        return Reflect.get(target, p, receiver);
      },
      // Just don't use define property. Why bother making it reactive.
      // defineProperty: (target, property, attributes) => {
      //   return Reflect.defineProperty(target, property, attributes);
      // },
      deleteProperty: (target, p) => {
        const d = _getRecursivePropDescriptor(target, p)
        if (d && (d.set || d.get)) {
          return false;
        }

        // Trigger the whole set code because I don't feel like rewritting it.
        target[hidden].proxy[p] = undefined;

        delete target[p];

        return true;
      },
      ownKeys: target => {
        const keys = Reflect.ownKeys(target).filter(k => k !== hidden);
        return keys;
      }
    }
  );
  obj[hidden].proxy = p;

  for (const prop of [...Object.getOwnPropertyNames(p), ...Object.getOwnPropertySymbols(p)]) {
    if (_isProxifiable(obj[prop], classesToProxify)) {
      obj[prop] = _proxifyInternal(obj[prop], p, classesToProxify);
    }
  }

  return p;
}

function proxify<T extends object>(obj: T, classesToProxify?: any[]) {
  return _proxifyInternal(obj, null, classesToProxify ? [...classesToProxify] : []) as T;
}

let _lastFound = false;
function _subscribeInternal<T>(getTarget: () => T, callback: () => void, subscriptionData: any) {
  let found = false;
  _lastFound = false;

  // Initialize proxy tracker
  _lastValidProxy = null;
  _lastProp = '';

  try {
    getTarget();
    found = true;
    _lastFound = true;

    if (_lastValidProxy === null) {
      throw Error("State is not proxified. Bitch");
    }
  } catch (e) {
    if (!(e instanceof TypeError)) {
      throw e;
    }
  }

  // Initialize subscription data
  const obj = _lastValidProxy;
  const prop = _lastProp;
  const internalCallback: (() => void) = () => {
    // Unsubscribe
    const {obj, prop, internalCallback} = subscriptionData;
    const handlers = obj[hidden].handlers;
    if (!handlers[prop]) return;
    handlers[prop] = handlers[prop].filter((h: any) => h !== internalCallback);
    if (handlers[prop].length === 0) {
      delete handlers[prop];
    }

    // Resubscribe
    // attempts fireOnFound if current subscription didn't find the intended target
    // Example:
    // if subscribed to () => obj.a.b
    // but current object is obj = {}
    // Then we are listening to prop 'a' on object 'obj'
    // If we then set obj = {a: {b: 1}} the callback will be called here
    _subscribeInternal(getTarget, callback, subscriptionData);

    // Call callback (if appropriate)
    if (found || _lastFound) {
      callback();
    }
  };
  (internalCallback as any).update = () => {
    // Just unsubscribe and resubscribe without calling callback

    // Unsubscribe
    const {obj, prop, internalCallback} = subscriptionData;
    const handlers = obj[hidden].handlers;
    if (!handlers[prop]) return;
    handlers[prop] = handlers[prop].filter((h: any) => h !== internalCallback);
    if (handlers[prop].length === 0) {
      delete handlers[prop];
    }

    // Resubscribe
    _subscribeInternal(getTarget, callback, subscriptionData);
  };
  (internalCallback as any).original = callback;

  if (!obj[hidden].handlers[prop]) {
    obj[hidden].handlers[prop] = [];
  }
  obj[hidden].handlers[prop].push(internalCallback);

  // Update subscription data
  subscriptionData.obj = obj;
  subscriptionData.prop = prop;
  subscriptionData.internalCallback = internalCallback;

  // Unsubscribe using subscription data
  return () => {
    const {obj, prop, internalCallback} = subscriptionData;
    const handlers = obj[hidden].handlers;
    if (!handlers[prop]) return;
    handlers[prop] = handlers[prop].filter((h: any) => h !== internalCallback);
    if (handlers[prop].length === 0) {
      delete handlers[prop];
    }
  };
}

function subscribe<T>(getTarget: () => T, callback: () => void) {
  return _subscribeInternal(getTarget, callback, {});
}


type EffectCallback = () => void | Destructor;
type Destructor = (() => void);
type DependencyList = readonly unknown[];
type SetStateAction<S> = S | ((prevState: S) => S);
type Dispatch<A> = (value: A) => void;
// function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
const createReactHook = (
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void,
  useState: <S>(initialState: S | (() => S)) => [S, Dispatch<SetStateAction<S>>]
) => {
  return <T, S>(
    getTarget: () => T,
    /** Returns react state that will be used.
     * 
     * WARNING: Objects need to change ids or react compile won't rerender.
     * That means shallow copy object and arrays and whatever cloning methods are appropriate for other classes...
     * Treat it as a react set state function returned by the useState hook. */
    updateState: () => S
  ): S => {
    const [state, setStateInternal] = useState(updateState);
    useEffect(() => {
      return subscribe(getTarget, () => {
        setStateInternal(updateState);
      });
    }, []);
    return state;
  }
};

export {
  proxify,
  subscribe,
  createReactHook
}


// (Intended) Features
// * doesn't batch :(
// * no listener arguments (User keeping track of old values always works better)
// * handlers run bottom to top
// * illegal mutations throw errors! (Can't react to a value change and change the value in the reaction)
// * can handle cyclical structures

