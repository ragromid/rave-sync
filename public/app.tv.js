/* Smart TV / Older WebView Polyfills (Chrome 49+ / WebOS / Tizen) */
(function () {
  if (typeof Object.entries !== 'function') {
    Object.entries = function (obj) {
      var keys = Object.keys(obj);
      var res = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) res[i] = [keys[i], obj[keys[i]]];
      return res;
    };
  }
  if (typeof Object.values !== 'function') {
    Object.values = function (obj) {
      var keys = Object.keys(obj);
      var res = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) res[i] = obj[keys[i]];
      return res;
    };
  }
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function (cb) {
      var P = this.constructor;
      return this.then(
        function (val) { return P.resolve(cb()).then(function () { return val; }); },
        function (err) { return P.resolve(cb()).then(function () { throw err; }); }
      );
    };
  }
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var d = depth === undefined ? 1 : Number(depth);
      var flatten = function (arr, lvl) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && lvl > 0) out = out.concat(flatten(arr[i], lvl - 1));
          else out.push(arr[i]);
        }
        return out;
      };
      return flatten(this, d);
    };
  }
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (search, replacement) {
      if (search instanceof RegExp) return this.replace(search, replacement);
      return this.split(String(search)).join(String(replacement));
    };
  }
  if (typeof NodeList !== 'undefined' && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
  if (typeof window.CSS === 'undefined') window.CSS = {};
  if (typeof window.CSS.escape !== 'function') {
    window.CSS.escape = function (val) {
      return String(val).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
    };
  }
})();

/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var runtime = (function (exports) {
  "use strict";

  var Op = Object.prototype;
  var hasOwn = Op.hasOwnProperty;
  var defineProperty = Object.defineProperty || function (obj, key, desc) { obj[key] = desc.value; };
  var undefined; // More compressible than void 0.
  var $Symbol = typeof Symbol === "function" ? Symbol : {};
  var iteratorSymbol = $Symbol.iterator || "@@iterator";
  var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
  var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

  function define(obj, key, value) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    return obj[key];
  }
  try {
    // IE 8 has a broken Object.defineProperty that only works on DOM objects.
    define({}, "");
  } catch (err) {
    define = function(obj, key, value) {
      return obj[key] = value;
    };
  }

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
    var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
    var generator = Object.create(protoGenerator.prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    defineProperty(generator, "_invoke", { value: makeInvokeMethod(innerFn, self, context) });

    return generator;
  }
  exports.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  // This is a polyfill for %IteratorPrototype% for environments that
  // don't natively support it.
  var IteratorPrototype = {};
  define(IteratorPrototype, iteratorSymbol, function () {
    return this;
  });

  var getProto = Object.getPrototypeOf;
  var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
  if (NativeIteratorPrototype &&
      NativeIteratorPrototype !== Op &&
      hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
    // This environment has a native %IteratorPrototype%; use it instead
    // of the polyfill.
    IteratorPrototype = NativeIteratorPrototype;
  }

  var Gp = GeneratorFunctionPrototype.prototype =
    Generator.prototype = Object.create(IteratorPrototype);
  GeneratorFunction.prototype = GeneratorFunctionPrototype;
  defineProperty(Gp, "constructor", { value: GeneratorFunctionPrototype, configurable: true });
  defineProperty(
    GeneratorFunctionPrototype,
    "constructor",
    { value: GeneratorFunction, configurable: true }
  );
  GeneratorFunction.displayName = define(
    GeneratorFunctionPrototype,
    toStringTagSymbol,
    "GeneratorFunction"
  );

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      define(prototype, method, function(arg) {
        return this._invoke(method, arg);
      });
    });
  }

  exports.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  exports.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
      define(genFun, toStringTagSymbol, "GeneratorFunction");
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `hasOwn.call(value, "__await")` to determine if the yielded value is
  // meant to be awaited.
  exports.awrap = function(arg) {
    return { __await: arg };
  };

  function AsyncIterator(generator, PromiseImpl) {
    function invoke(method, arg, resolve, reject) {
      var record = tryCatch(generator[method], generator, arg);
      if (record.type === "throw") {
        reject(record.arg);
      } else {
        var result = record.arg;
        var value = result.value;
        if (value &&
            typeof value === "object" &&
            hasOwn.call(value, "__await")) {
          return PromiseImpl.resolve(value.__await).then(function(value) {
            invoke("next", value, resolve, reject);
          }, function(err) {
            invoke("throw", err, resolve, reject);
          });
        }

        return PromiseImpl.resolve(value).then(function(unwrapped) {
          // When a yielded Promise is resolved, its final value becomes
          // the .value of the Promise<{value,done}> result for the
          // current iteration.
          result.value = unwrapped;
          resolve(result);
        }, function(error) {
          // If a rejected Promise was yielded, throw the rejection back
          // into the async generator function so it can be handled there.
          return invoke("throw", error, resolve, reject);
        });
      }
    }

    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return new PromiseImpl(function(resolve, reject) {
          invoke(method, arg, resolve, reject);
        });
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : callInvokeWithMethodAndArg();
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    defineProperty(this, "_invoke", { value: enqueue });
  }

  defineIteratorMethods(AsyncIterator.prototype);
  define(AsyncIterator.prototype, asyncIteratorSymbol, function () {
    return this;
  });
  exports.AsyncIterator = AsyncIterator;

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  exports.async = function(innerFn, outerFn, self, tryLocsList, PromiseImpl) {
    if (PromiseImpl === void 0) PromiseImpl = Promise;

    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList),
      PromiseImpl
    );

    return exports.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per GeneratorResume behavior specified since ES2015:
        // ES2015 spec, step 3: https://262.ecma-international.org/6.0/#sec-generatorresume
        // Latest spec, step 2: https://tc39.es/ecma262/#sec-generatorresume
        return doneResult();
      }

      context.method = method;
      context.arg = arg;

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          var delegateResult = maybeInvokeDelegate(delegate, context);
          if (delegateResult) {
            if (delegateResult === ContinueSentinel) continue;
            return delegateResult;
          }
        }

        if (context.method === "next") {
          // Setting context._sent for legacy support of Babel's
          // function.sent implementation.
          context.sent = context._sent = context.arg;

        } else if (context.method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw context.arg;
          }

          context.dispatchException(context.arg);

        } else if (context.method === "return") {
          context.abrupt("return", context.arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          if (record.arg === ContinueSentinel) {
            continue;
          }

          return {
            value: record.arg,
            done: context.done
          };

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(context.arg) call above.
          context.method = "throw";
          context.arg = record.arg;
        }
      }
    };
  }

  // Call delegate.iterator[context.method](context.arg) and handle the
  // result, either by returning a { value, done } result from the
  // delegate iterator, or by modifying context.method and context.arg,
  // setting context.delegate to null, and returning the ContinueSentinel.
  function maybeInvokeDelegate(delegate, context) {
    var methodName = context.method;
    var method = delegate.iterator[methodName];
    if (method === undefined) {
      // A .throw or .return when the delegate iterator has no .throw
      // method, or a missing .next method, always terminate the
      // yield* loop.
      context.delegate = null;

      // Note: ["return"] must be used for ES3 parsing compatibility.
      if (methodName === "throw" && delegate.iterator["return"]) {
        // If the delegate iterator has a return method, give it a
        // chance to clean up.
        context.method = "return";
        context.arg = undefined;
        maybeInvokeDelegate(delegate, context);

        if (context.method === "throw") {
          // If maybeInvokeDelegate(context) changed context.method from
          // "return" to "throw", let that override the TypeError below.
          return ContinueSentinel;
        }
      }
      if (methodName !== "return") {
        context.method = "throw";
        context.arg = new TypeError(
          "The iterator does not provide a '" + methodName + "' method");
      }

      return ContinueSentinel;
    }

    var record = tryCatch(method, delegate.iterator, context.arg);

    if (record.type === "throw") {
      context.method = "throw";
      context.arg = record.arg;
      context.delegate = null;
      return ContinueSentinel;
    }

    var info = record.arg;

    if (! info) {
      context.method = "throw";
      context.arg = new TypeError("iterator result is not an object");
      context.delegate = null;
      return ContinueSentinel;
    }

    if (info.done) {
      // Assign the result of the finished delegate to the temporary
      // variable specified by delegate.resultName (see delegateYield).
      context[delegate.resultName] = info.value;

      // Resume execution at the desired location (see delegateYield).
      context.next = delegate.nextLoc;

      // If context.method was "throw" but the delegate handled the
      // exception, let the outer generator proceed normally. If
      // context.method was "next", forget context.arg since it has been
      // "consumed" by the delegate iterator. If context.method was
      // "return", allow the original .return call to continue in the
      // outer generator.
      if (context.method !== "return") {
        context.method = "next";
        context.arg = undefined;
      }

    } else {
      // Re-yield the result returned by the delegate method.
      return info;
    }

    // The delegate iterator is finished, so forget it and continue with
    // the outer generator.
    context.delegate = null;
    return ContinueSentinel;
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  define(Gp, toStringTagSymbol, "Generator");

  // A Generator should always return itself as the iterator object when the
  // @@iterator function is called on it. Some browsers' implementations of the
  // iterator prototype chain incorrectly implement this, causing the Generator
  // object to not be returned from this call. This ensures that doesn't happen.
  // See https://github.com/facebook/regenerator/issues/274 for more details.
  define(Gp, iteratorSymbol, function() {
    return this;
  });

  define(Gp, "toString", function() {
    return "[object Generator]";
  });

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  exports.keys = function(val) {
    var object = Object(val);
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable != null) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    throw new TypeError(typeof iterable + " is not iterable");
  }
  exports.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      // Resetting context._sent for legacy support of Babel's
      // function.sent implementation.
      this.sent = this._sent = undefined;
      this.done = false;
      this.delegate = null;

      this.method = "next";
      this.arg = undefined;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;

        if (caught) {
          // If the dispatched exception was caught by a catch block,
          // then let that catch block handle the exception normally.
          context.method = "next";
          context.arg = undefined;
        }

        return !! caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.method = "next";
        this.next = finallyEntry.finallyLoc;
        return ContinueSentinel;
      }

      return this.complete(record);
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = this.arg = record.arg;
        this.method = "return";
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }

      return ContinueSentinel;
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      if (this.method === "next") {
        // Deliberately forget the last sent value so that we don't
        // accidentally pass it on to the delegate.
        this.arg = undefined;
      }

      return ContinueSentinel;
    }
  };

  // Regardless of whether this script is executing as a CommonJS module
  // or not, return the runtime object so that we can declare the variable
  // regeneratorRuntime in the outer scope, which allows this module to be
  // injected easily by `bin/regenerator --include-runtime script.js`.
  return exports;

}(
  // If this script is executing as a CommonJS module, use module.exports
  // as the regeneratorRuntime namespace. Otherwise create a new empty
  // object. Either way, the resulting object will be used to initialize
  // the regeneratorRuntime variable at the top of this file.
  typeof module === "object" ? module.exports : {}
));

try {
  regeneratorRuntime = runtime;
} catch (accidentalStrictMode) {
  // This module should not be running in strict mode, so the above
  // assignment should always work unless something is misconfigured. Just
  // in case runtime.js accidentally runs in strict mode, in modern engines
  // we can explicitly access globalThis. In older engines we can escape
  // strict mode using a global Function call. This could conceivably fail
  // if a Content Security Policy forbids using Function, but in that case
  // the proper solution is to fix the accidental strict mode problem. If
  // you've misconfigured your bundler to force strict mode and applied a
  // CSP to forbid Function, and you're not willing to fix either of those
  // problems, please detail your unique predicament in a GitHub issue.
  if (typeof globalThis === "object") {
    globalThis.regeneratorRuntime = runtime;
  } else {
    Function("r", "regeneratorRuntime = r")(runtime);
  }
}

function _regeneratorValues(e) { if (null != e) { var t = e["function" == typeof Symbol && Symbol.iterator || "@@iterator"], r = 0; if (t) return t.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) return { next: function next() { return e && r >= e.length && (e = void 0), { value: e && e[r++], done: !e }; } }; } throw new TypeError(typeof e + " is not iterable"); }
function _slicedToArray(e, i) { return _iterableToArrayLimit(e, i) || _unsupportedIterableToArray(e, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, t) { var e = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (Array.isArray(r) && (null == e || e === ("undefined" != typeof Symbol && [][Symbol.iterator]) || e === []["@@iterator"])) return r; if (null != e) { var l, n, i, a, u = [], o = !0, f = !1; try { if (i = (e = e.call(r)).next, 0 === t) { if (Object(e) !== e) return; o = !1; } else for (; !(o = (l = i.call(e)).done) && (u.push(l.value), u.length !== t); o = !0); } catch (r) { f = !0, n = r; } finally { try { if (!o && null != e.return && (a = e.return(), Object(a) !== a)) return; } finally { if (f) throw n; } } return u; } }
function _createForOfIteratorHelper(e, t) { var _n = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"]; if (!_n) { if (Array.isArray(e) || (_n = _unsupportedIterableToArray(e)) || t && e && "number" == typeof e.length) { _n && (e = _n); var o = 0, F = function F() {}; return { s: F, n: function n() { return o >= e.length ? { done: !0 } : { done: !1, value: e[o++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var a, u, i = !0; return { s: function s() { _n = _n.call(e); }, n: function n() { i = !0; var r = _n.next(); return r.done ? { done: !0 } : { value: r.value, done: i = !1 }; }, e: function e(r) { a = !0, u = r; }, f: function f() { try { i || null == _n.return || _n.return(); } finally { if (a) throw u; } } }; }
function _unsupportedIterableToArray(t, e) { if (t) { if ("string" == typeof t) return _arrayLikeToArray(t, e); var o = {}.toString.call(t).slice(8, -1); return "Object" === o && t.constructor && (o = t.constructor.name), "Map" === o || "Set" === o ? Array.from(t) : "Arguments" === o || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(o) ? _arrayLikeToArray(t, e) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _regenerator() { var r, e, o = "function" == typeof Symbol ? Symbol : {}, n = o.iterator || "@@iterator", a = o.toStringTag || "@@toStringTag"; function i(o, n, a, i) { var u = n && n.prototype instanceof Generator ? n : Generator, f = Object.create(u.prototype); return _regeneratorDefine2(f, "_invoke", function (t, o, n) { var a, i, u, f = 0, p = n || [], y = !1, G = { p: 0, n: 0, v: r, a: l, f: l.bind(r, 4), d: function d(t, e) { return a = t, i = 0, u = r, G.n = e, c; } }; function l(t, o) { for (i = t, u = o, e = 0; !y && f && !n && e < p.length; e++) { var n, a = p[e], l = G.p, F = a[2]; t > 3 ? (n = F === o) && (u = a[(i = a[4]) ? 5 : (i = 3, 3)], a[4] = a[5] = r) : a[0] <= l && ((n = t < 2 && l < a[1]) ? (i = 0, G.v = o, G.n = a[1]) : l < F && (n = t < 3 || a[0] > o || o > F) && (a[4] = t, a[5] = o, G.n = F, i = 0)); } if (n || t > 1) return c; throw y = !0, o; } return function (n, p, F) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && l(p, F), i = p, u = F; (e = i < 2 ? r : u) || !y;) { a || (i ? (i > 1 && (G.n = i < 3 ? -1 : u), l(i, u)) : G.v = u); try { if (f = 2, a) { if (i || (n = "next"), e = a[n]) { if (!(e = e.call(a, u))) throw TypeError("iterator result is not an object"); if (!e.done) return e; u = e.value, i < 2 && (i = 0); } else 1 === i && (e = a.return) && e.call(a), i < 2 && (u = TypeError("The iterator does not provide a '" + n + "' method"), i = 1); a = r; } else if ((e = (y = G.n < 0) ? u : t.call(o, G)) !== c) break; } catch (t) { a = r, i = 1, u = t; } finally { f = 1; } } return { value: e, done: y }; }; }(o, a, i), !0), f; } var c = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} e = Object.getPrototypeOf; var u = [][n] ? e(e([][n]())) : (_regeneratorDefine2(e = {}, n, function () { return this; }), e), f = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(u); function p(r) { return Object.setPrototypeOf ? Object.setPrototypeOf(r, GeneratorFunctionPrototype) : (r.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(r, a, "GeneratorFunction")), r.prototype = Object.create(f), r; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(f, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, a, "GeneratorFunction"), _regeneratorDefine2(f), _regeneratorDefine2(f, a, "Generator"), _regeneratorDefine2(f, n, function () { return this; }), _regeneratorDefine2(f, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: p }; })(); }
function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(r) { for (var t = 1; t < arguments.length; t++) { var o = null != arguments[t] ? arguments[t] : {}; t % 2 ? ownKeys(Object(o), !0).forEach(function (t) { _defineProperty(r, t, o[t]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(r, Object.getOwnPropertyDescriptors(o)) : ownKeys(Object(o)).forEach(function (e) { Object.defineProperty(r, e, Object.getOwnPropertyDescriptor(o, e)); }); } return r; }
function _defineProperty(r, t, o) { return (t = _toPropertyKey(t)) in r ? Object.defineProperty(r, t, { value: o, enumerable: !0, configurable: !0, writable: !0 }) : r[t] = o, r; }
function _toPropertyKey(r) { var o = _toPrimitive(r, "string"); return "symbol" == typeof o ? o : o + ""; }
function _toPrimitive(t, e) { if ("object" != typeof t || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
((_$, _$2, _$4, _$5, _$6, _$7, _$8, _$9, _$0, _$1, _$10, _$12, _$13, _$15, _$16, _$20, _$21, _$22, _$27, _$30, _$34, _$35, _$36, _$37, _$38, _$39, _$40, _$41, _$42, _$43, _$44, _$45, _$46, _$47, _$48, _$49, _$50, _$52, _$54, _$56, _$60, _$63, _$64, _$65, _$66, _$67, _$69, _$70, _$72, _$74, _$75, _$76, _$78, _$80, _$81, _$83, _$84, _$85, _$92, _$94, _$95, _$98, _$100, _$101, _$103, _$104, _$105, _$107, _$109, _$110, _$111) => {
  'use strict';
  if (typeof window !== 'undefined' && window.location) {
    var host = window.location.hostname;
    var isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === '130.61.47.155';
    if (isIp && host !== '127.0.0.1' && host !== 'localhost' || host === 'oulo.duckdns.org' && window.location.protocol === 'http:' || host === 'rave-sync.duckdns.org') {
      var target = 'https://oulo.duckdns.org' + window.location.pathname + window.location.search + window.location.hash;
      window.location.replace(target);
      return;
    }
  }
  var state = {
    token: '',
    user: null,
    bookmarks: [],
    history: [],
    progress: {},
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    publicRooms: [],
    currentView: 'explore',
    category: 'trending',
    page: 1,
    searchQuery: '',
    heroMovie: null,
    selectedMovie: null,
    savedTab: 'bookmarks',
    room: null,
    proxyMode: localStorage.getItem('ravelampa_proxy_mode') || 'auto',
    soundEnabled: localStorage.getItem('ravelampa_sound_enabled') !== 'false',
    inAppNotifsEnabled: localStorage.getItem('ravelampa_inapp_notifs') !== 'false',
    autoSync: localStorage.getItem('ravelampa_auto_sync') !== 'false',
    z01: {
      movie: null,
      uid: '',
      sources: [],
      activeSourceKey: '',
      seasons: [],
      activeSeasonIdx: 0,
      voices: [],
      activeVoiceIdx: 0,
      videos: [],
      activeVideoIdx: 0,
      qualities: {},
      activeQuality: '',
      openDropdown: ''
    },
    clientId: 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36),
    lastAppliedActionId: '',
    tvMode: /[?&](msx|tv)=1/i.test(window.location.search || '') || /SmartTV|Tizen|Web0S|WebOS|NetCast|BRAVIA|AFT|Android TV|GoogleTV|Viera|Hisense|VIDAA|PhilipsTV|Opera TV|HbbTV|MSX|Xbox|PlayStation/i.test(navigator.userAgent || ''),
    tvCinemaMode: false,
    hls: null,
    ytPlayer: null,
    ytReady: false,
    suppressSyncEmit: false,
    justLoadedMediaUntil: 0,
    lastSyncAt: 0,
    mobileRoomTab: 'chat',
    unreadChatCount: 0,
    voiceActive: false,
    localStream: null,
    peers: new Map()
  };
  var isVercelHost = /\.vercel\.app$/i.test(window.location.hostname);
  var socket = !isVercelHost && typeof window.io === 'function' ? window.io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  }) : {
    connected: false,
    on() {},
    emit() {}
  };
  var $ = id => document.getElementById(id);
  function setupMobileViewport() {
    var isTyping = false;
    function update() {
      var vv = window.visualViewport;
      var windowH = window.innerHeight;
      var vvH = vv ? Math.round(vv.height) : windowH;
      var offsetTop = vv ? Math.round(vv.offsetTop) : 0;
      var keyboardOverlap = Math.max(0, Math.round(windowH - (offsetTop + vvH)));
      var isKeyboardOpen = isTyping || keyboardOverlap > 50 || windowH - vvH > 80;
      document.documentElement.style.setProperty('--app-height', `${vvH}px`);
      document.documentElement.style.setProperty('--app-top', `${offsetTop}px`);
      document.body.classList.toggle('keyboard-open', isKeyboardOpen);
      var shell = document.querySelector('.app-shell');
      if (shell) {
        shell.style.height = `${vvH}px`;
        shell.style.top = `${offsetTop}px`;
      }
      if (isKeyboardOpen) {
        if (state.currentView === 'room') {
          var chatMsgs = $('chatMessages');
          if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
          var rDMs = $('roomDmMessages');
          if (rDMs) rDMs.scrollTop = rDMs.scrollHeight;
        } else if (state.currentView === 'friends') {
          var fDMs = $('dmMessages');
          if (fDMs) fDMs.scrollTop = fDMs.scrollHeight;
        }
      }
    }
    document.addEventListener('focusin', e => {
      var target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (target.classList.contains('chat-input-field') || target.id === 'chatInput' || target.id === 'roomDmInput' || target.id === 'dmInput') {
          isTyping = true;
          document.body.classList.add('keyboard-open');
          setTimeout(() => {
            update();
            var chatMsgs = $('chatMessages');
            if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
          }, 120);
        }
      }
    });
    document.addEventListener('focusout', e => {
      var target = e.target;
      if (target && (target.classList.contains('chat-input-field') || target.id === 'chatInput' || target.id === 'roomDmInput' || target.id === 'dmInput')) {
        setTimeout(() => {
          var _active$classList;
          var active = document.activeElement;
          if (!active || !((_active$classList = active.classList) !== null && _active$classList !== void 0 && _active$classList.contains('chat-input-field')) && active.id !== 'chatInput' && active.id !== 'roomDmInput' && active.id !== 'dmInput') {
            isTyping = false;
            document.body.classList.remove('keyboard-open');
            update();
          }
        }, 120);
      }
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', update);
      window.visualViewport.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => setTimeout(update, 200));
    update();
  }
  setupMobileViewport();
  function getChatInputValue(elOrId) {
    var el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return '';
    if (el.isContentEditable) {
      return (el.innerText || el.textContent || '').trim();
    }
    return (el.value || '').trim();
  }
  function setChatInputValue(elOrId, val) {
    var el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    if (el.isContentEditable) {
      el.innerText = val || '';
    } else {
      el.value = val || '';
    }
  }
  function clearChatInput(elOrId) {
    var el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    if (el.isContentEditable) {
      el.innerHTML = '';
      el.innerText = '';
    } else {
      el.value = '';
    }
  }
  function focusChatInput(elOrId) {
    var el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    el.focus();
    if (el.isContentEditable && window.getSelection && document.createRange) {
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
    }
  }
  function attachChatInputHandlers(inputId, sendBtnId, sendFn) {
    var input = $(inputId);
    var btn = $(sendBtnId);
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendFn();
        }
      });
      if (input.isContentEditable) {
        input.addEventListener('paste', e => {
          var _ref;
          e.preventDefault();
          var text = ((_ref = e.clipboardData || window.clipboardData) === null || _ref === void 0 ? void 0 : _ref.getData('text/plain')) || '';
          document.execCommand('insertText', false, text);
        });
      }
    }
    if (btn) {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
      });
      btn.addEventListener('click', e => {
        e.preventDefault();
        sendFn();
      });
    }
  }
  function api(_x) {
    return _api.apply(this, arguments);
  }
  function _api() {
    _api = _asyncToGenerator(_regenerator().m(function _callee17(path, options = {}) {
      var headers, res, data;
      return _regenerator().w(function (_context17) {
        while (1) switch (_context17.n) {
          case 0:
            headers = _objectSpread({
              'Content-Type': 'application/json'
            }, options.headers || {});
            if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
            _context17.n = 1;
            return fetch(path, _objectSpread(_objectSpread({
              credentials: 'same-origin'
            }, options), {}, {
              headers
            }));
          case 1:
            res = _context17.v;
            _context17.n = 2;
            return res.json().catch(() => ({}));
          case 2:
            data = _context17.v;
            if (res.ok) {
              _context17.n = 3;
              break;
            }
            throw new Error(data.error || `HTTP ${res.status}`);
          case 3:
            return _context17.a(2, data);
        }
      }, _callee17);
    }));
    return _api.apply(this, arguments);
  }
  function esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function avatarInnerHtml(u, fallbackEmoji = '🦊') {
    if (u && u.avatarUrl) {
      return `<img class="avatar-img" src="${esc(u.avatarUrl)}" alt="" />`;
    }
    return esc(u && u.avatar || fallbackEmoji);
  }
  function setAvatarElement(el, u, fallbackEmoji = '🦊') {
    if (!el) return;
    el.style.background = u && u.color || '#00e676';
    if (u && u.avatarUrl) {
      el.innerHTML = `<img class="avatar-img" src="${esc(u.avatarUrl)}" alt="" />`;
    } else {
      el.textContent = u && u.avatar || fallbackEmoji;
    }
  }
  function formatWatchTime(seconds) {
    var sec = Math.max(0, Number(seconds) || 0);
    var mins = Math.floor(sec / 60);
    if (mins < 60) return `${mins} мин`;
    var hrs = Math.floor(mins / 60);
    var remMins = mins % 60;
    return remMins > 0 ? `${hrs} ч ${remMins} м` : `${hrs} ч`;
  }
  function showToast(text, actionLabel, onAction, duration = 4500) {
    var container = $('toastContainer');
    var el = document.createElement('div');
    el.className = 'toast-item';
    el.innerHTML = `<div>${esc(text)}</div>`;
    if (actionLabel && typeof onAction === 'function') {
      var btn = document.createElement('button');
      btn.className = 'btn primary tiny';
      btn.style.height = '30px';
      btn.textContent = actionLabel;
      btn.onclick = () => {
        el.remove();
        onAction();
      };
      el.appendChild(btn);
    }
    container.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, duration);
  }
  var swRegistration = null;
  var audioCtx = null;
  var notifBannerDismissed = false;
  var notifiedDmIds = new Set();
  var notifiedReqIds = new Set();
  var notifiedEventIds = new Set();
  var recentNotifTags = new Set();
  var initialFriendsLoaded = false;
  var friendsPollInFlight = false;
  var dmPollInFlight = false;
  var lastVisibilityResumeAt = 0;
  try {
    var savedDmIds = JSON.parse(sessionStorage.getItem('oulo_notified_dm_ids') || '[]');
    savedDmIds.forEach(id => notifiedDmIds.add(id));
    var savedTags = JSON.parse(sessionStorage.getItem('oulo_notified_tags') || '[]');
    savedTags.forEach(t => recentNotifTags.add(t));
  } catch (_unused) {}
  function markDmNotified(id) {
    if (!id) return;
    notifiedDmIds.add(id);
    try {
      var arr = Array.from(notifiedDmIds).slice(-250);
      sessionStorage.setItem('oulo_notified_dm_ids', JSON.stringify(arr));
    } catch (_unused2) {}
  }
  function markTagNotified(tag) {
    if (!tag) return;
    recentNotifTags.add(tag);
    if (recentNotifTags.size > 300) {
      var first = recentNotifTags.values().next().value;
      recentNotifTags.delete(first);
    }
    try {
      var arr = Array.from(recentNotifTags).slice(-250);
      sessionStorage.setItem('oulo_notified_tags', JSON.stringify(arr));
    } catch (_unused3) {}
  }
  function clearActiveOsNotifications() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'CLEAR_NOTIFICATIONS'
        });
      }
      if (swRegistration && typeof swRegistration.getNotifications === 'function') {
        swRegistration.getNotifications().then(list => {
          list.forEach(n => {
            try {
              n.close();
            } catch (_unused4) {}
          });
        }).catch(() => {});
      }
    } catch (_unused5) {}
  }
  socket.on('connect', () => {
    var _state$room;
    if (state.token) {
      socket.emit('auth:identify', {
        token: state.token,
        visible: !document.hidden
      });
    }
    var activeCode = (_state$room = state.room) === null || _state$room === void 0 ? void 0 : _state$room.code;
    if (!activeCode) {
      try {
        activeCode = sessionStorage.getItem('active_room_code');
      } catch (_unused6) {}
    }
    if (activeCode) {
      socket.emit('room:join', {
        code: activeCode,
        token: state.token
      });
    }
  });
  function syncAppVisibilityToServer() {
    var isVisible = !document.hidden;
    if (isVisible) {
      lastVisibilityResumeAt = Date.now();
      clearActiveOsNotifications();
    }
    if (socket && socket.connected) {
      socket.emit('app:visibility', {
        visible: isVisible
      });
    }
  }
  document.addEventListener('visibilitychange', syncAppVisibilityToServer);
  window.addEventListener('focus', () => {
    lastVisibilityResumeAt = Date.now();
    clearActiveOsNotifications();
    if (socket && socket.connected) socket.emit('app:visibility', {
      visible: true
    });
  });
  window.addEventListener('pagehide', () => {
    if (socket && socket.connected) socket.emit('app:visibility', {
      visible: false
    });
  });
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
  function ensureWebPushSubscribed() {
    return _ensureWebPushSubscribed.apply(this, arguments);
  }
  function _ensureWebPushSubscribed() {
    _ensureWebPushSubscribed = _asyncToGenerator(_regenerator().m(function _callee18() {
      var sub, keyRes, _t11;
      return _regenerator().w(function (_context18) {
        while (1) switch (_context18.p = _context18.n) {
          case 0:
            _context18.p = 0;
            if (!(!state.user || !swRegistration || !swRegistration.pushManager)) {
              _context18.n = 1;
              break;
            }
            return _context18.a(2);
          case 1:
            if (!(!('Notification' in window) || Notification.permission !== 'granted')) {
              _context18.n = 2;
              break;
            }
            return _context18.a(2);
          case 2:
            _context18.n = 3;
            return swRegistration.pushManager.getSubscription();
          case 3:
            sub = _context18.v;
            if (sub) {
              _context18.n = 7;
              break;
            }
            _context18.n = 4;
            return api('/api/push/vapid-public-key');
          case 4:
            keyRes = _context18.v;
            if (keyRes !== null && keyRes !== void 0 && keyRes.publicKey) {
              _context18.n = 5;
              break;
            }
            return _context18.a(2);
          case 5:
            _context18.n = 6;
            return swRegistration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey)
            });
          case 6:
            sub = _context18.v;
          case 7:
            if (!sub) {
              _context18.n = 8;
              break;
            }
            _context18.n = 8;
            return api('/api/push/subscribe', {
              method: 'POST',
              body: JSON.stringify({
                subscription: sub.toJSON ? sub.toJSON() : sub
              })
            });
          case 8:
            _context18.n = 10;
            break;
          case 9:
            _context18.p = 9;
            _t11 = _context18.v;
          case 10:
            return _context18.a(2);
        }
      }, _callee18, null, [[0, 9]]);
    }));
    return _ensureWebPushSubscribed.apply(this, arguments);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      swRegistration = reg;
      ensureWebPushSubscribed();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', event => {
      var msg = event.data;
      if (!msg) return;
      if (msg.type === 'RAVELAMPA_NOTIFICATION_CLICK') {
        var d = msg.data || {};
        clearActiveOsNotifications();
        if (d.friendId) {
          if (state.currentView === 'room' && state.room) {
            setMobileRoomTab('dms');
            openRoomDmChat(d.friendId);
          } else {
            switchView('friends');
            openFriendChat(d.friendId);
          }
        } else if (d.roomCode) {
          if (state.room && state.room.code === d.roomCode) {
            switchView('room');
            setMobileRoomTab('chat');
          } else {
            joinRoomByCode(d.roomCode);
          }
        } else if (d.view) {
          switchView(d.view);
        }
      } else if (msg.type === 'RAVELAMPA_PUSH_SILENT_ACK') {
        if (msg.msgId) markDmNotified(msg.msgId);
        if (msg.tag) markTagNotified(msg.tag);
      } else if (msg.type === 'RAVELAMPA_PUSH_EVENT' && msg.payload) {
        var p = msg.payload;
        if (p.type === 'dm_message' && p.msg) {
          var dm = p.msg;
          handleIncomingOrOutgoingDm(dm);
          if (activeDmFriendId === dm.fromId || roomActiveDmFriendId === dm.fromId) {
            pollActiveDmChat();
          }
        } else if (p.type === 'room_chat' && p.msg) {
          appendChatMessage(p.msg, true);
        } else if (p.title) {
          var _p$invitePayload;
          triggerAppNotification({
            title: p.title,
            body: p.body || '',
            user: ((_p$invitePayload = p.invitePayload) === null || _p$invitePayload === void 0 ? void 0 : _p$invitePayload.from) || null,
            kind: 'invite',
            data: _objectSpread(_objectSpread({}, p.data || {}), {}, {
              tag: p.tag || 'push-' + Date.now()
            }),
            onClick: () => {
              var _p$data;
              if ((_p$data = p.data) !== null && _p$data !== void 0 && _p$data.roomCode) joinRoomByCode(p.data.roomCode);else switchView('friends');
            }
          });
          loadFriends();
        }
      }
    });
  }
  function playNotificationSound(kind = 'message') {
    if (state.soundEnabled === false) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      var now = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var osc2 = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc2.type = 'sine';
      if (kind === 'invite') {
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.11);
        osc2.frequency.setValueAtTime(1174.66, now + 0.11);
      } else {
        osc.frequency.setValueAtTime(659.25, now);
        osc.frequency.setValueAtTime(783.99, now + 0.08);
        osc2.frequency.setValueAtTime(1318.5, now + 0.08);
      }
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.55, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.35);
      osc2.stop(now + 0.35);
    } catch (_unused7) {}
  }
  var inAppSoundUnlocked = false;
  try {
    inAppSoundUnlocked = localStorage.getItem('ravelampa_notif_enabled') === '1';
  } catch (_unused8) {}
  function isIosSafariTab() {
    var _window$matchMedia, _window;
    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    var isStandalone = ((_window$matchMedia = (_window = window).matchMedia) === null || _window$matchMedia === void 0 || (_window$matchMedia = _window$matchMedia.call(_window, '(display-mode: standalone)')) === null || _window$matchMedia === void 0 ? void 0 : _window$matchMedia.matches) || window.navigator.standalone === true;
    return isIOS && !isStandalone;
  }
  function updateNotificationBellUi() {
    var hasNotifApi = 'Notification' in window;
    var perm = hasNotifApi ? Notification.permission : inAppSoundUnlocked ? 'granted' : 'default';
    var bellIcon = $('notifBellIcon');
    var bellBtn = $('notifBellBtn');
    var banner = $('notifPermissionBanner');
    if (bellIcon && bellBtn) {
      if (perm === 'granted' || inAppSoundUnlocked) {
        bellIcon.textContent = '🔔';
        bellBtn.title = 'Уведомления включены (нажмите для проверки)';
      } else {
        bellIcon.textContent = '🔕';
        bellBtn.title = 'Нажмите, чтобы разрешить уведомления';
      }
    }
    if (banner) {
      if (perm === 'default' && !inAppSoundUnlocked && state.user && !notifBannerDismissed) {
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }
  }
  function requestPermissionCompat() {
    return new Promise(resolve => {
      try {
        var res = Notification.requestPermission(perm => resolve(perm));
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(() => resolve(Notification.permission));
        }
      } catch (_unused9) {
        resolve('denied');
      }
    });
  }
  function requestBrowserNotificationPermission() {
    return _requestBrowserNotificationPermission.apply(this, arguments);
  }
  function _requestBrowserNotificationPermission() {
    _requestBrowserNotificationPermission = _asyncToGenerator(_regenerator().m(function _callee19() {
      var perm, _t12;
      return _regenerator().w(function (_context19) {
        while (1) switch (_context19.p = _context19.n) {
          case 0:
            playNotificationSound('invite');
            inAppSoundUnlocked = true;
            try {
              localStorage.setItem('ravelampa_notif_enabled', '1');
            } catch (_unused37) {}
            if ('Notification' in window) {
              _context19.n = 1;
              break;
            }
            updateNotificationBellUi();
            if (isIosSafariTab()) {
              triggerAppNotification({
                title: 'Звук и уведомления в Safari включены! 🔔',
                body: 'На iPhone системные уведомления на экран блокировки работают, если нажать «Поделиться ⬆️ → На экран Домой 📲»',
                user: state.user || {
                  avatar: '🍏',
                  color: '#00e676'
                }
              });
            } else {
              triggerAppNotification({
                title: 'Встроенные уведомления включены! 🔔',
                body: 'Вы будете получать всплывающие карточки и звуковой сигнал при новых сообщениях.',
                user: state.user || {
                  avatar: '🔔',
                  color: '#00e676'
                }
              });
            }
            return _context19.a(2);
          case 1:
            _context19.p = 1;
            _context19.n = 2;
            return requestPermissionCompat();
          case 2:
            perm = _context19.v;
            updateNotificationBellUi();
            if (perm === 'granted') {
              ensureWebPushSubscribed();
              triggerAppNotification({
                title: 'Уведомления включены! 🔔',
                body: 'Теперь вы будете получать сообщения от друзей и приглашения в комнаты как в Telegram.',
                user: state.user || {
                  avatar: '🔔',
                  color: '#00e676'
                },
                forceSystem: true
              });
            } else if (perm === 'denied') {
              showToast('Системные уведомления запрещены в настройках Safari, но встроенные уведомления со звуком работают!');
            }
            _context19.n = 4;
            break;
          case 3:
            _context19.p = 3;
            _t12 = _context19.v;
          case 4:
            return _context19.a(2);
        }
      }, _callee19, null, [[1, 3]]);
    }));
    return _requestBrowserNotificationPermission.apply(this, arguments);
  }
  (_$ = $('notifAllowBtn')) === null || _$ === void 0 || _$.addEventListener('click', requestBrowserNotificationPermission);
  (_$2 = $('notifDismissBtn')) === null || _$2 === void 0 || _$2.addEventListener('click', () => {
    var _$3;
    notifBannerDismissed = true;
    (_$3 = $('notifPermissionBanner')) === null || _$3 === void 0 || _$3.classList.add('hidden');
  });
  (_$4 = $('notifBellBtn')) === null || _$4 === void 0 || _$4.addEventListener('click', () => {
    var hasGrant = 'Notification' in window && Notification.permission === 'granted';
    if (!hasGrant) {
      requestBrowserNotificationPermission();
    } else {
      triggerAppNotification({
        title: 'Проверка уведомлений 🔔',
        body: 'Уведомления и звук oulo работают отлично!',
        user: state.user || {
          avatar: '🔔',
          color: '#00e676'
        },
        forceSystem: true
      });
    }
  });
  function showTelegramTopCard({
    title,
    body,
    user,
    onClick
  }) {
    if (state.inAppNotifsEnabled === false) return;
    var container = $('tgTopNotifContainer');
    if (!container) return;
    var card = document.createElement('div');
    card.className = 'tg-notif-card';
    var avHtml = avatarInnerHtml(user, '🔔');
    var avBg = user && user.color || '#00e676';
    card.innerHTML = `
      <div class="avatar-circle" style="background:${esc(avBg)};width:38px;height:38px;font-size:1.1rem;flex-shrink:0;">${avHtml}</div>
      <div class="tg-notif-body">
        <div class="tg-notif-title">${esc(title)}</div>
        <div class="tg-notif-sub">${esc(body)}</div>
      </div>
      <button type="button" class="tg-notif-close" title="Закрыть">✕</button>
    `;
    card.querySelector('.tg-notif-close').onclick = e => {
      e.stopPropagation();
      card.remove();
    };
    card.onclick = () => {
      card.remove();
      if (typeof onClick === 'function') onClick();
    };
    container.appendChild(card);
    while (container.children.length > 3) {
      container.firstElementChild.remove();
    }
    setTimeout(() => {
      if (card.parentNode) card.remove();
    }, 6000);
  }
  var titleFlashTimer = null;
  function flashTabTitle(text) {
    clearTimeout(titleFlashTimer);
    document.title = `💬 ${text} — oulo`;
    titleFlashTimer = setTimeout(() => {
      document.title = 'oulo — совместный просмотр';
    }, 5000);
  }
  function triggerAppNotification({
    title,
    body,
    user,
    onClick,
    data = {},
    kind = 'message',
    forceSystem = false
  }) {
    var tag = data.tag || '';
    if (!forceSystem && tag) {
      if (recentNotifTags.has(tag)) return;
      markTagNotified(tag);
    }
    if (!forceSystem && (document.hidden || Date.now() - lastVisibilityResumeAt < 2500)) {
      return;
    }
    if (!forceSystem && !document.hidden) {
      if (data.friendId) {
        var viewingDm = state.currentView === 'friends' && activeDmFriendId === data.friendId || state.currentView === 'room' && state.mobileRoomTab === 'dms' && roomActiveDmFriendId === data.friendId;
        if (viewingDm) return;
      }
      if (data.roomCode && String(tag).startsWith('roomchat-')) {
        var viewingRoomChat = state.currentView === 'room' && (window.innerWidth > 900 || state.mobileRoomTab === 'chat');
        if (viewingRoomChat) return;
      }
    }
    playNotificationSound(kind);
    showTelegramTopCard({
      title,
      body,
      user,
      onClick
    });
    flashTabTitle(title);
    if (forceSystem && 'Notification' in window && Notification.permission === 'granted') {
      var opts = {
        body,
        tag: tag || 'oulo-' + Date.now(),
        data,
        renotify: false
      };
      if (swRegistration && typeof swRegistration.showNotification === 'function') {
        swRegistration.showNotification(title, opts).catch(() => {
          try {
            new Notification(title, opts);
          } catch (_unused0) {}
        });
      } else {
        try {
          var n = new Notification(title, opts);
          n.onclick = () => {
            window.focus();
            n.close();
            if (typeof onClick === 'function') onClick();
          };
        } catch (_unused1) {}
      }
    }
  }
  function switchView(viewName) {
    state.currentView = viewName;
    document.body.classList.toggle('in-room-view', viewName === 'room');
    if (viewName !== 'friends') document.body.classList.remove('in-friends-chat');
    document.querySelectorAll('.view-page').forEach(p => p.classList.remove('active'));
    var target = $(`view-${viewName}`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    var returnBtn = $('returnToRoomBtn');
    if (state.room && viewName !== 'room') {
      returnBtn.classList.remove('hidden');
    } else {
      returnBtn.classList.add('hidden');
    }
    if (viewName === 'rooms') loadPublicRooms();
    if (viewName === 'friends') loadFriends();
    if (viewName === 'saved') renderSavedGrid();
  }
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.goto));
  });
  var brandClickCombo = 0;
  var brandComboResetTimer = null;
  var easterSecretQuotes = ['🎬 Секретный режим oulo активирован — запущен рандомный топ-фильм!', '🍿 Пасхалка найдена! Включаем случайный шедевр на вечер...', '⚡ oulo OVERDRIVE: выбираем для вас лучший фильм из каталога!', '✨ Магия кино активирована — ловите случайную рекомендацию!'];
  function playBrandEasterSound(stage = 1) {
    if (!state.soundEnabled) return;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      var now = ctx.currentTime;
      var notes = stage >= 5 ? [523.25, 659.25, 783.99, 1046.5] : [587.33 + stage * 70, 880 + stage * 90];
      notes.forEach((freq, i) => {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = stage >= 5 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.055);
        gain.gain.setValueAtTime(0.08, now + i * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.055);
        osc.stop(now + i * 0.055 + 0.3);
      });
      setTimeout(() => ctx.close().catch(() => {}), 800);
    } catch (_unused10) {}
  }
  function spawnBrandParticles(originEl, count = 14, spread = 65) {
    if (!originEl) return;
    var rect = originEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var _loop = function _loop() {
      var p = document.createElement('div');
      p.className = 'oulo-easter-particle';
      var isGreen = i % 3 !== 0;
      var size = Math.round(4 + Math.random() * 5);
      var angle = Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.4;
      var dist = spread * (0.45 + Math.random() * 0.75);
      var tx = Math.round(Math.cos(angle) * dist);
      var ty = Math.round(Math.sin(angle) * dist);
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${cx - size / 2}px`;
      p.style.top = `${cy - size / 2}px`;
      p.style.background = isGreen ? '#00e676' : '#ffffff';
      p.style.boxShadow = isGreen ? '0 0 10px #00e676' : '0 0 8px #ffffff';
      p.style.setProperty('--tx', `${tx}px`);
      p.style.setProperty('--ty', `${ty}px`);
      p.style.setProperty('--dur', `${500 + Math.round(Math.random() * 350)}ms`);
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 900);
    };
    for (var i = 0; i < count; i++) {
      _loop();
    }
  }
  $('brandLogo').addEventListener('click', () => {
    switchView('explore');
    var brand = $('brandLogo');
    var icon = (brand === null || brand === void 0 ? void 0 : brand.querySelector('.brand-icon')) || brand;
    brandClickCombo++;
    clearTimeout(brandComboResetTimer);
    brandComboResetTimer = setTimeout(() => {
      brandClickCombo = 0;
    }, 1800);
    if (brand) {
      brand.classList.remove('easter-spin');
      void brand.offsetWidth;
      brand.classList.add('easter-spin');
    }
    if (brandClickCombo >= 5) {
      brandClickCombo = 0;
      spawnBrandParticles(icon, 36, 130);
      playBrandEasterSound(5);
      if (brand) {
        brand.classList.add('easter-overdrive');
        setTimeout(() => brand.classList.remove('easter-overdrive'), 2600);
      }
      var msg = easterSecretQuotes[Math.floor(Math.random() * easterSecretQuotes.length)];
      showToast(msg);
      var cards = Array.from(document.querySelectorAll('#catalogGrid .poster-card'));
      if (cards.length > 0) {
        var randomCard = cards[Math.floor(Math.random() * cards.length)];
        setTimeout(() => randomCard.click(), 350);
      }
    } else {
      spawnBrandParticles(icon, 12 + brandClickCombo * 4, 55 + brandClickCombo * 12);
      playBrandEasterSound(brandClickCombo);
      if (brandClickCombo === 3) {
        showToast('👀 Ещё 2 нажатия до секретной пасхалки oulo...');
      }
    }
  });
  $('returnToRoomBtn').addEventListener('click', () => switchView('room'));
  function openModal(id) {
    var el = $(id);
    if (el) el.classList.remove('hidden');
  }
  function closeModal(id) {
    var el = $(id);
    if (el) el.classList.add('hidden');
  }
  function isTvSelectKey(e) {
    if (!e) return false;
    var k = e.key;
    var c = e.keyCode || e.which;
    return k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'Select' || k === 'OK' || k === 'Accept' || c === 13 || c === 32 || c === 23 || c === 66 || c === 29443 || c === 10182 || c === 1536 || c === 1537 || c === 10252;
  }
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden'));
  });
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });
  var authMode = 'login';
  var pendingAvatarUrl = null;
  function updateHeaderUser() {
    if (state.user) {
      setAvatarElement($('headerUserAvatar'), state.user, '🦊');
      $('headerUserName').textContent = state.user.displayName;
    } else {
      $('headerUserAvatar').textContent = '👤';
      $('headerUserAvatar').style.background = '#00e676';
      $('headerUserName').textContent = 'Войти';
    }
  }
  function applyServerUserData(data) {
    var _state$user;
    state.token = data.token || state.token || '';
    state.user = data.user || null;
    state.bookmarks = data.bookmarks || [];
    state.history = data.history || [];
    state.progress = data.progress || {};
    if ((_state$user = state.user) !== null && _state$user !== void 0 && (_state$user = _state$user.settings) !== null && _state$user !== void 0 && _state$user.proxyMode) {
      state.proxyMode = state.user.settings.proxyMode;
      var labels = {
        auto: '⚡ Прокси: Авто',
        always: '🛡️ Прокси: Вкл',
        off: '🌐 Прокси: Выкл'
      };
      document.querySelectorAll('.btn-toggle-proxy, #toggleProxyStreamBtn').forEach(btn => {
        var btnSpan = btn.querySelector('span');
        if (btnSpan && labels[state.proxyMode]) btnSpan.textContent = labels[state.proxyMode];else if (labels[state.proxyMode]) btn.textContent = labels[state.proxyMode];
      });
    }
    updateHeaderUser();
    updateNotificationBellUi();
    ensureWebPushSubscribed();
    if (state.token) {
      socket.emit('auth:identify', {
        token: state.token,
        visible: !document.hidden
      });
    }
  }
  function initAuth() {
    return _initAuth.apply(this, arguments);
  }
  function _initAuth() {
    _initAuth = _asyncToGenerator(_regenerator().m(function _callee20() {
      var data, _t13, _t14;
      return _regenerator().w(function (_context20) {
        while (1) switch (_context20.p = _context20.n) {
          case 0:
            _context20.p = 0;
            try {
              localStorage.removeItem('ravelampa_token');
            } catch (_unused39) {}
            _context20.n = 1;
            return api('/api/auth/me');
          case 1:
            data = _context20.v;
            if (!(data && data.user && data.user.username && data.user.username.startsWith('guest_'))) {
              _context20.n = 6;
              break;
            }
            _context20.p = 2;
            _context20.n = 3;
            return api('/api/auth/logout', {
              method: 'POST'
            });
          case 3:
            _context20.n = 5;
            break;
          case 4:
            _context20.p = 4;
            _t13 = _context20.v;
          case 5:
            state.token = '';
            state.user = null;
            updateHeaderUser();
            return _context20.a(2);
          case 6:
            applyServerUserData(data);
            loadFriends();
            _context20.n = 8;
            break;
          case 7:
            _context20.p = 7;
            _t14 = _context20.v;
            state.token = '';
            state.user = null;
            updateHeaderUser();
          case 8:
            return _context20.a(2);
        }
      }, _callee20, null, [[2, 4], [0, 7]]);
    }));
    return _initAuth.apply(this, arguments);
  }
  function computeUserAchievements(st = {}) {
    var badges = [];
    var watchHours = (st.watchSeconds || 0) / 3600;
    var totalWatched = (st.moviesWatched || 0) + (st.episodesWatched || 0) || st.historyCount || 0;
    if (totalWatched >= 1 || watchHours >= 0.5) {
      badges.push({
        ico: '🍿',
        label: totalWatched >= 25 ? 'Киноман (25+)' : 'Зритель oulo'
      });
    }
    if (watchHours >= 10) {
      badges.push({
        ico: '🦉',
        label: `${Math.floor(watchHours)}ч в кинозале`
      });
    }
    if ((st.roomsCreated || 0) >= 1) {
      badges.push({
        ico: '👑',
        label: (st.roomsCreated || 0) >= 10 ? 'Топ-хост комнат' : 'Создатель комнат'
      });
    }
    if ((st.messagesSent || 0) >= 15 || (st.reactionsSent || 0) >= 15) {
      badges.push({
        ico: '🔥',
        label: 'Душа компании'
      });
    }
    if ((st.friendsCount || 0) >= 3) {
      badges.push({
        ico: '🤝',
        label: 'Киноклуб'
      });
    }
    return badges;
  }
  function renderBadgesStrip(containerId, st = {}) {
    var el = $(containerId);
    if (!el) return;
    var badges = computeUserAchievements(st);
    el.innerHTML = badges.map(b => `<span class="ach-badge"><span class="ach-badge-ico">${b.ico}</span><span>${esc(b.label)}</span></span>`).join('');
  }
  function populateProfileStats(user) {
    var _ref2, _st$friendsCount;
    var st = (user === null || user === void 0 ? void 0 : user.stats) || {};
    if ($('statWatchTime')) $('statWatchTime').textContent = formatWatchTime(st.watchSeconds || 0);
    var watchedTotal = (st.moviesWatched || 0) + (st.episodesWatched || 0) || st.historyCount || state.history.length || 0;
    if ($('statWatchedCount')) $('statWatchedCount').textContent = watchedTotal;
    if ($('statRoomsCreated')) $('statRoomsCreated').textContent = st.roomsCreated || 0;
    if ($('statMessagesSent')) $('statMessagesSent').textContent = st.messagesSent || 0;
    if ($('statReactionsSent')) $('statReactionsSent').textContent = st.reactionsSent || 0;
    var friendsCnt = (_ref2 = (_st$friendsCount = st.friendsCount) !== null && _st$friendsCount !== void 0 ? _st$friendsCount : state.friends.length) !== null && _ref2 !== void 0 ? _ref2 : 0;
    if ($('statSocialCount')) $('statSocialCount').textContent = `${friendsCnt}`;
  }
  function switchProfileFolder(target) {
    var mapped = target === 'settings' || target === 'notifications' || target === 'playback' ? 'settings' : 'profile';
    document.querySelectorAll('.pfolder-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.ptab === mapped);
    });
    document.querySelectorAll('.pfolder-content').forEach(c => {
      c.classList.toggle('active', c.id === `ptab-${mapped}`);
    });
    if (mapped === 'settings') {
      updateProfileNotifUI();
      updateProfilePlaybackUI();
    }
  }
  document.querySelectorAll('.pfolder-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchProfileFolder(tab.dataset.ptab);
    });
  });
  function updateProfileNotifUI() {
    var hasNotifApi = 'Notification' in window;
    var perm = hasNotifApi ? Notification.permission : inAppSoundUnlocked ? 'granted' : 'default';
    var sub = $('notifFolderSub');
    var btn = $('profileNotifToggleBtn');
    var soundToggle = $('profileSoundToggle');
    var inAppToggle = $('profileInAppNotifToggle');
    if (soundToggle) soundToggle.checked = state.soundEnabled !== false;
    if (inAppToggle) inAppToggle.checked = state.inAppNotifsEnabled !== false;
    if (!btn) return;
    if (perm === 'granted' || inAppSoundUnlocked) {
      if (sub) sub.textContent = 'Активны в браузере';
      btn.textContent = 'Тест';
      btn.className = 'pill-btn tiny accent';
    } else if (perm === 'denied') {
      if (sub) sub.textContent = 'Заблокированы в браузере';
      btn.textContent = 'Разрешить';
      btn.className = 'pill-btn tiny danger';
    } else {
      if (sub) sub.textContent = 'Разрешить оповещения';
      btn.textContent = 'Включить';
      btn.className = 'pill-btn tiny accent';
    }
  }
  (_$5 = $('profileNotifToggleBtn')) === null || _$5 === void 0 || _$5.addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee() {
    var hasGrant;
    return _regenerator().w(function (_context) {
      while (1) switch (_context.n) {
        case 0:
          hasGrant = 'Notification' in window && Notification.permission === 'granted';
          if (hasGrant) {
            _context.n = 2;
            break;
          }
          _context.n = 1;
          return requestBrowserNotificationPermission();
        case 1:
          updateProfileNotifUI();
          _context.n = 3;
          break;
        case 2:
          triggerAppNotification({
            title: 'Проверка уведомлений 🔔',
            body: 'Уведомления и звук oulo работают отлично!',
            user: state.user || {
              avatar: '🔔',
              color: '#00e676'
            },
            forceSystem: true
          });
          showToast('Тестовое уведомление отправлено!');
        case 3:
          return _context.a(2);
      }
    }, _callee);
  })));
  (_$6 = $('profileSoundToggle')) === null || _$6 === void 0 || _$6.addEventListener('change', e => {
    state.soundEnabled = e.target.checked;
    localStorage.setItem('ravelampa_sound_enabled', state.soundEnabled ? 'true' : 'false');
    showToast(state.soundEnabled ? '🔊 Звуки сообщений включены' : '🔇 Звуки сообщений выключены');
  });
  (_$7 = $('profileInAppNotifToggle')) === null || _$7 === void 0 || _$7.addEventListener('change', e => {
    state.inAppNotifsEnabled = e.target.checked;
    localStorage.setItem('ravelampa_inapp_notifs', state.inAppNotifsEnabled ? 'true' : 'false');
    showToast(state.inAppNotifsEnabled ? '💬 Всплывающие карточки включены' : '💬 Всплывающие карточки выключены');
  });
  function updateProfilePlaybackUI() {
    var grid = $('profileProxyGrid');
    if (grid) {
      grid.querySelectorAll('.proxy-opt-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pmode === state.proxyMode);
      });
    }
    var syncToggle = $('profileSyncToggle');
    if (syncToggle) syncToggle.checked = state.autoSync !== false;
    document.querySelectorAll('.audio-boost-btn').forEach(btn => {
      var val = parseFloat(btn.dataset.boost);
      btn.classList.toggle('active', Math.abs(val - currentVolumeMultiplier) < 0.05);
    });
  }
  document.querySelectorAll('.audio-boost-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      var target = parseFloat(btn.dataset.boost);
      adjustTvVolume(target - currentVolumeMultiplier);
    });
  });
  (_$8 = $('profileProxyGrid')) === null || _$8 === void 0 || _$8.addEventListener('click', e => {
    var btn = e.target.closest('.proxy-opt-btn');
    if (!btn) return;
    state.proxyMode = btn.dataset.pmode || 'auto';
    localStorage.setItem('ravelampa_proxy_mode', state.proxyMode);
    updateProfilePlaybackUI();
    var modeNames = {
      auto: '⚡ Авто',
      always: '🛡️ Всегда через сервер',
      off: '🚀 Напрямую без прокси'
    };
    showToast(`Режим потока: ${modeNames[state.proxyMode] || state.proxyMode}`);
  });
  (_$9 = $('profileSyncToggle')) === null || _$9 === void 0 || _$9.addEventListener('change', e => {
    state.autoSync = e.target.checked;
    localStorage.setItem('ravelampa_auto_sync', state.autoSync ? 'true' : 'false');
    showToast(state.autoSync ? '🔄 Автосинхронизация включена' : '⏸️ Автосинхронизация выключена');
  });
  (_$0 = $('profileClearCacheBtn')) === null || _$0 === void 0 || _$0.addEventListener('click', () => {
    localStorage.removeItem('ravelampa_progress');
    showToast('Кэш просмотра очищен');
  });
  (_$1 = $('copyMsxUrlBtn')) === null || _$1 === void 0 || _$1.addEventListener('click', () => {
    var _navigator$clipboard;
    var msxHost = window.location.host || 'oulo.duckdns.org';
    (_navigator$clipboard = navigator.clipboard) === null || _navigator$clipboard === void 0 || _navigator$clipboard.writeText(msxHost).catch(() => {});
    showToast(`Скопировано: ${msxHost} (вставьте в Start Parameter в Media Station X)`);
  });
  (_$10 = $('savePersonalizationBtn')) === null || _$10 === void 0 || _$10.addEventListener('click', () => {
    var _$11;
    (_$11 = $('profileForm')) === null || _$11 === void 0 || _$11.requestSubmit();
  });
  function openAuthModal() {
    return _openAuthModal.apply(this, arguments);
  }
  function _openAuthModal() {
    _openAuthModal = _asyncToGenerator(_regenerator().m(function _callee21(defaultTab = 'profile') {
      var modal, fresh, _t15;
      return _regenerator().w(function (_context21) {
        while (1) switch (_context21.p = _context21.n) {
          case 0:
            modal = $('authModal');
            modal.classList.remove('hidden');
            if (!state.user) {
              _context21.n = 5;
              break;
            }
            $('authGuestView').classList.add('hidden');
            $('authProfileView').classList.remove('hidden');
            switchProfileFolder(defaultTab);
            pendingAvatarUrl = null;
            setAvatarElement($('profileBigAvatar'), state.user, '🦊');
            $('removePhotoBtn').classList.toggle('hidden', !state.user.avatarUrl);
            $('profileUsernameTag').textContent = `@${state.user.username}`;
            $('profileDisplayName').value = state.user.displayName || '';
            $('profileBio').value = state.user.bio || '';
            document.querySelectorAll('#profileAvatarPicker .av-pick').forEach(b => {
              b.classList.toggle('selected', b.dataset.av === state.user.avatar);
            });
            document.querySelectorAll('#profileColorPicker .color-swatch').forEach(sw => {
              sw.classList.toggle('selected', sw.dataset.color === (state.user.color || '#00e676'));
            });
            populateProfileStats(state.user);
            updateProfileNotifUI();
            updateProfilePlaybackUI();
            _context21.p = 1;
            _context21.n = 2;
            return api('/api/auth/me');
          case 2:
            fresh = _context21.v;
            if (fresh.user) {
              state.user = fresh.user;
              populateProfileStats(state.user);
            }
            _context21.n = 4;
            break;
          case 3:
            _context21.p = 3;
            _t15 = _context21.v;
          case 4:
            _context21.n = 6;
            break;
          case 5:
            $('authGuestView').classList.remove('hidden');
            $('authProfileView').classList.add('hidden');
          case 6:
            return _context21.a(2);
        }
      }, _callee21, null, [[1, 3]]);
    }));
    return _openAuthModal.apply(this, arguments);
  }
  (_$12 = $('userMenuBtn')) === null || _$12 === void 0 || _$12.addEventListener('click', () => openAuthModal('profile'));
  $('uploadPhotoBtn').addEventListener('click', () => {
    $('profilePhotoInput').click();
  });
  (_$13 = $('profileBigAvatar')) === null || _$13 === void 0 || _$13.addEventListener('click', () => {
    var _$14;
    (_$14 = $('profilePhotoInput')) === null || _$14 === void 0 || _$14.click();
  });
  $('profilePhotoInput').addEventListener('change', e => {
    var _e$target$files;
    var file = (_e$target$files = e.target.files) === null || _e$target$files === void 0 ? void 0 : _e$target$files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = () => {
      var img = new Image();
      img.onload = () => {
        var canvas = document.createElement('canvas');
        var size = 160;
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var minSide = Math.min(img.width, img.height);
        var sx = (img.width - minSide) / 2;
        var sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        pendingAvatarUrl = dataUrl;
        $('profileBigAvatar').innerHTML = `<img class="avatar-img" src="${esc(dataUrl)}" alt="" />`;
        $('removePhotoBtn').classList.remove('hidden');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  $('removePhotoBtn').addEventListener('click', () => {
    var _document$querySelect, _state$user2;
    pendingAvatarUrl = '';
    var selectedEmoji = ((_document$querySelect = document.querySelector('#profileAvatarPicker .av-pick.selected')) === null || _document$querySelect === void 0 ? void 0 : _document$querySelect.dataset.av) || ((_state$user2 = state.user) === null || _state$user2 === void 0 ? void 0 : _state$user2.avatar) || '🦊';
    $('profileBigAvatar').textContent = selectedEmoji;
    $('removePhotoBtn').classList.add('hidden');
  });
  $('profileColorPicker').addEventListener('click', e => {
    var sw = e.target.closest('.color-swatch');
    if (!sw) return;
    document.querySelectorAll('#profileColorPicker .color-swatch').forEach(b => b.classList.remove('selected'));
    sw.classList.add('selected');
    $('profileBigAvatar').style.background = sw.dataset.color;
  });
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      authMode = tab.dataset.atab;
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      var isReg = authMode === 'register';
      $('authDisplayNameGroup').style.display = isReg ? 'flex' : 'none';
      $('authAvatarGroup').style.display = isReg ? 'flex' : 'none';
      $('authSubmitBtn').textContent = isReg ? 'Создать аккаунт' : 'Войти';
      $('authError').classList.add('hidden');
    });
  });
  document.querySelectorAll('.avatar-picker').forEach(picker => {
    picker.addEventListener('click', e => {
      var _state$user3;
      var btn = e.target.closest('.av-pick');
      if (!btn) return;
      picker.querySelectorAll('.av-pick').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (picker.id === 'profileAvatarPicker' && (pendingAvatarUrl === '' || !pendingAvatarUrl && !((_state$user3 = state.user) !== null && _state$user3 !== void 0 && _state$user3.avatarUrl))) {
        $('profileBigAvatar').textContent = btn.dataset.av;
      }
    });
  });
  $('authForm').addEventListener('submit', function () {
    var _ref4 = _asyncToGenerator(_regenerator().m(function _callee2(e) {
      var _document$querySelect2;
      var errEl, username, password, displayName, selectedAv, endpoint, data, pendingRoom, _t;
      return _regenerator().w(function (_context2) {
        while (1) switch (_context2.p = _context2.n) {
          case 0:
            e.preventDefault();
            errEl = $('authError');
            errEl.classList.add('hidden');
            username = $('authUsername').value.trim();
            password = $('authPassword').value;
            displayName = $('authDisplayName').value.trim();
            selectedAv = ((_document$querySelect2 = document.querySelector('#registerAvatarPicker .av-pick.selected')) === null || _document$querySelect2 === void 0 ? void 0 : _document$querySelect2.dataset.av) || '🦊';
            _context2.p = 1;
            endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
            _context2.n = 2;
            return api(endpoint, {
              method: 'POST',
              body: JSON.stringify({
                username,
                password,
                displayName,
                avatar: selectedAv
              })
            });
          case 2:
            data = _context2.v;
            applyServerUserData(data);
            $('authModal').classList.add('hidden');
            showToast(`Привет, ${state.user.displayName}!`);
            loadFriends();
            try {
              pendingRoom = sessionStorage.getItem('active_room_code');
              if (pendingRoom) {
                sessionStorage.removeItem('active_room_code');
                joinRoomByCode(pendingRoom);
              }
            } catch (_unused11) {}
            _context2.n = 4;
            break;
          case 3:
            _context2.p = 3;
            _t = _context2.v;
            errEl.textContent = _t.message;
            errEl.classList.remove('hidden');
          case 4:
            return _context2.a(2);
        }
      }, _callee2, null, [[1, 3]]);
    }));
    return function (_x2) {
      return _ref4.apply(this, arguments);
    };
  }());
  $('profileForm').addEventListener('submit', function () {
    var _ref5 = _asyncToGenerator(_regenerator().m(function _callee3(e) {
      var _document$querySelect3, _document$querySelect4;
      var displayName, bio, avatar, color, payload, data, _t2;
      return _regenerator().w(function (_context3) {
        while (1) switch (_context3.p = _context3.n) {
          case 0:
            e.preventDefault();
            displayName = $('profileDisplayName').value.trim();
            bio = $('profileBio').value.trim();
            avatar = ((_document$querySelect3 = document.querySelector('#profileAvatarPicker .av-pick.selected')) === null || _document$querySelect3 === void 0 ? void 0 : _document$querySelect3.dataset.av) || state.user.avatar;
            color = ((_document$querySelect4 = document.querySelector('#profileColorPicker .color-swatch.selected')) === null || _document$querySelect4 === void 0 ? void 0 : _document$querySelect4.dataset.color) || state.user.color || '#00e676';
            payload = {
              displayName,
              bio,
              avatar,
              color
            };
            if (pendingAvatarUrl !== null) {
              payload.avatarUrl = pendingAvatarUrl;
            }
            _context3.p = 1;
            _context3.n = 2;
            return api('/api/auth/profile', {
              method: 'PUT',
              body: JSON.stringify(payload)
            });
          case 2:
            data = _context3.v;
            state.user = data.user;
            updateHeaderUser();
            if (state.token) socket.emit('auth:identify', {
              token: state.token
            });
            $('authModal').classList.add('hidden');
            showToast('Профиль обновлён');
            _context3.n = 4;
            break;
          case 3:
            _context3.p = 3;
            _t2 = _context3.v;
            showToast(_t2.message);
          case 4:
            return _context3.a(2);
        }
      }, _callee3, null, [[1, 3]]);
    }));
    return function (_x3) {
      return _ref5.apply(this, arguments);
    };
  }());
  function openUserCard(_x4) {
    return _openUserCard.apply(this, arguments);
  }
  function _openUserCard() {
    _openUserCard = _asyncToGenerator(_regenerator().m(function _callee22(userId) {
      var data, u, st, tmBox, tm, sharedList, sharedLabel, _t16;
      return _regenerator().w(function (_context22) {
        while (1) switch (_context22.p = _context22.n) {
          case 0:
            if (userId) {
              _context22.n = 1;
              break;
            }
            return _context22.a(2);
          case 1:
            if (!(state.user && userId === state.user.id)) {
              _context22.n = 2;
              break;
            }
            openAuthModal();
            return _context22.a(2);
          case 2:
            _context22.p = 2;
            _context22.n = 3;
            return api(`/api/users/${encodeURIComponent(userId)}`);
          case 3:
            data = _context22.v;
            u = data.user;
            if (u) {
              _context22.n = 4;
              break;
            }
            return _context22.a(2);
          case 4:
            setAvatarElement($('ucAvatar'), u, '🦊');
            $('ucDisplayName').textContent = u.displayName;
            $('ucUsername').textContent = `@${u.username}`;
            $('ucBio').textContent = u.bio || 'Участник oulo';
            st = u.stats || {};
            tmBox = $('ucTasteMatchBox');
            if (tmBox) {
              tm = data.tasteMatch;
              if (tm && (tm.matchPercent > 0 || tm.theirBookmarks && tm.theirBookmarks.length > 0)) {
                tmBox.classList.remove('hidden');
                sharedList = tm.sharedMovies && tm.sharedMovies.length > 0 ? tm.sharedMovies : (tm.theirBookmarks || []).slice(0, 6);
                sharedLabel = tm.sharedMovies && tm.sharedMovies.length > 0 ? `Общие фильмы (${tm.sharedMovies.length}):` : 'В закладках:';
                tmBox.innerHTML = `
            <div class="taste-match-header">
              <span>Совпадение вкусов</span>
              <span class="taste-match-pct">${tm.matchPercent || 0}%</span>
            </div>
            <div class="taste-match-bar">
              <div class="taste-match-fill" style="width:${Math.max(6, tm.matchPercent || 0)}%"></div>
            </div>
            ${sharedList.length ? `
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;">${esc(sharedLabel)}</div>
              <div class="taste-shared-strip">
                ${sharedList.map((m, idx) => `<button type="button" class="taste-shared-chip" data-tm-idx="${idx}">${esc(m.title)}</button>`).join('')}
              </div>
            ` : ''}
          `;
                tmBox.querySelectorAll('[data-tm-idx]').forEach(btn => {
                  btn.onclick = () => {
                    var mv = sharedList[Number(btn.dataset.tmIdx)];
                    if (mv) {
                      $('userCardModal').classList.add('hidden');
                      openMovieModal(mv);
                    }
                  };
                });
              } else {
                tmBox.classList.add('hidden');
                tmBox.innerHTML = '';
              }
            }
            $('ucStatsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-val">${(st.moviesWatched || 0) + (st.episodesWatched || 0)}</div><div class="stat-label">Просмотрено</div></div>
        <div class="stat-card"><div class="stat-val">${esc(formatWatchTime(st.watchSeconds || 0))}</div><div class="stat-label">Время</div></div>
        <div class="stat-card"><div class="stat-val">${st.friendsCount || 0}</div><div class="stat-label">Друзья</div></div>
      `;
            $('userCardModal').classList.remove('hidden');
            _context22.n = 6;
            break;
          case 5:
            _context22.p = 5;
            _t16 = _context22.v;
          case 6:
            return _context22.a(2);
        }
      }, _callee22, null, [[2, 5]]);
    }));
    return _openUserCard.apply(this, arguments);
  }
  $('logoutBtn').addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee4() {
    var _t3;
    return _regenerator().w(function (_context4) {
      while (1) switch (_context4.p = _context4.n) {
        case 0:
          if (state.room) leaveRoom();
          _context4.p = 1;
          _context4.n = 2;
          return api('/api/auth/logout', {
            method: 'POST'
          });
        case 2:
          _context4.n = 4;
          break;
        case 3:
          _context4.p = 3;
          _t3 = _context4.v;
        case 4:
          state.token = '';
          state.user = null;
          state.bookmarks = [];
          state.history = [];
          state.progress = {};
          updateHeaderUser();
          $('authModal').classList.add('hidden');
          showToast('Вы вышли из аккаунта');
        case 5:
          return _context4.a(2);
      }
    }, _callee4, null, [[1, 3]]);
  })));
  function ensureAuthenticated() {
    return _ensureAuthenticated.apply(this, arguments);
  }
  function _ensureAuthenticated() {
    _ensureAuthenticated = _asyncToGenerator(_regenerator().m(function _callee23() {
      return _regenerator().w(function (_context23) {
        while (1) switch (_context23.n) {
          case 0:
            if (!(state.user && (!state.user.username || !state.user.username.startsWith('guest_')))) {
              _context23.n = 1;
              break;
            }
            return _context23.a(2, true);
          case 1:
            openAuthModal();
            showToast('Войдите или зарегистрируйтесь для продолжения');
            return _context23.a(2, false);
        }
      }, _callee23);
    }));
    return _ensureAuthenticated.apply(this, arguments);
  }
  var catalogLoading = false;
  var catalogHasMore = true;
  var catalogReqSeq = 0;
  var sentinelIntersecting = false;
  var seenCatalogIds = new Set();
  function loadCatalog() {
    return _loadCatalog.apply(this, arguments);
  }
  function _loadCatalog() {
    _loadCatalog = _asyncToGenerator(_regenerator().m(function _callee24(reset = true) {
      var reqId, loaderEl, _$112, data, rawItems, items, _iterator4, _step4, it, key, totalPages, _t17;
      return _regenerator().w(function (_context24) {
        while (1) switch (_context24.p = _context24.n) {
          case 0:
            if (!(!reset && (catalogLoading || !catalogHasMore))) {
              _context24.n = 1;
              break;
            }
            return _context24.a(2);
          case 1:
            $('heroBanner').classList.toggle('hidden', !!state.searchQuery);
            reqId = ++catalogReqSeq;
            catalogLoading = true;
            loaderEl = $('catalogInfiniteLoader');
            if (reset) {
              state.page = 1;
              catalogHasMore = true;
              seenCatalogIds.clear();
              $('catalogGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Загрузка каталога...</div>';
              if (loaderEl) loaderEl.classList.add('hidden');
            } else if (loaderEl) {
              loaderEl.classList.remove('hidden');
            }
            _context24.p = 2;
            if (!state.searchQuery) {
              _context24.n = 4;
              break;
            }
            _context24.n = 3;
            return api(`/api/catalog/search?q=${encodeURIComponent(state.searchQuery)}&page=${state.page}`);
          case 3:
            data = _context24.v;
            _context24.n = 6;
            break;
          case 4:
            _context24.n = 5;
            return api(`/api/catalog/feed?category=${encodeURIComponent(state.category)}&page=${state.page}`);
          case 5:
            data = _context24.v;
          case 6:
            if (!(reqId !== catalogReqSeq)) {
              _context24.n = 7;
              break;
            }
            return _context24.a(2);
          case 7:
            rawItems = data.results || [];
            items = [];
            _iterator4 = _createForOfIteratorHelper(rawItems);
            try {
              for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
                it = _step4.value;
                key = `${it.type || 'm'}_${it.id}`;
                if (!seenCatalogIds.has(key)) {
                  seenCatalogIds.add(key);
                  items.push(it);
                }
              }
            } catch (err) {
              _iterator4.e(err);
            } finally {
              _iterator4.f();
            }
            if (reset) {
              $('catalogGrid').innerHTML = '';
              if (items.length > 0 && !state.searchQuery && state.page === 1) {
                setHeroMovie(items[0]);
              }
            }
            renderPosterCards(items, $('catalogGrid'), false);
            state.catalogItems = reset ? items : [...(state.catalogItems || []), ...items];
            if (reset && items.length > 0 && state.tvMode) {
              setTimeout(() => {
                var firstCard = $('catalogGrid').querySelector('.poster-card');
                if (firstCard && (!document.activeElement || document.activeElement === document.body)) {
                  firstCard.focus();
                }
              }, 120);
            }
            totalPages = data.total_pages || 1;
            catalogHasMore = state.page < totalPages && rawItems.length > 0;
            (_$112 = $('loadMoreCatalogBtn')) === null || _$112 === void 0 || _$112.classList.add('hidden');
            _context24.n = 10;
            break;
          case 8:
            _context24.p = 8;
            _t17 = _context24.v;
            if (!(reqId !== catalogReqSeq)) {
              _context24.n = 9;
              break;
            }
            return _context24.a(2);
          case 9:
            if (reset) {
              $('catalogGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Ошибка загрузки: ${esc(_t17.message)}</div>`;
            }
            catalogHasMore = false;
          case 10:
            _context24.p = 10;
            if (reqId === catalogReqSeq) {
              catalogLoading = false;
              if (loaderEl) loaderEl.classList.add('hidden');
              if (sentinelIntersecting && catalogHasMore && state.currentView === 'explore') {
                requestAnimationFrame(() => {
                  if (sentinelIntersecting && !catalogLoading && catalogHasMore && state.currentView === 'explore') {
                    state.page++;
                    loadCatalog(false);
                  }
                });
              }
            }
            return _context24.f(10);
          case 11:
            return _context24.a(2);
        }
      }, _callee24, null, [[2, 8, 10, 11]]);
    }));
    return _loadCatalog.apply(this, arguments);
  }
  function setHeroMovie(movie) {
    if (!movie) return;
    state.heroMovie = movie;
    $('heroBackdrop').style.backgroundImage = `url('${movie.backdrop || movie.poster}')`;
    $('heroType').textContent = movie.type === 'tv' ? 'Сериал' : 'Фильм';
    $('heroRating').textContent = movie.vote_average ? `★ ${movie.vote_average}` : '★ Новинка';
    $('heroYear').textContent = movie.year || '';
    $('heroTitle').textContent = movie.title;
  }
  $('heroWatchPartyBtn').addEventListener('click', () => {
    if (state.heroMovie) openMovieModal(state.heroMovie);
  });
  $('heroDetailsBtn').addEventListener('click', () => {
    if (state.heroMovie) openMovieModal(state.heroMovie);
  });
  function setupGridDelegation(gridEl) {
    if (!gridEl || gridEl._delegatedBound) return;
    gridEl._delegatedBound = true;
    var activateCard = card => {
      if (!card) return;
      var movieId = card.dataset.movieId;
      var item = (state.catalogItems || []).find(x => String(x.id) === String(movieId)) || (state.bookmarks || []).find(x => String(x.id) === String(movieId)) || (state.history || []).map(h => h.movie).find(x => String(x === null || x === void 0 ? void 0 : x.id) === String(movieId));
      if (item) openMovieModal(item);
    };
    gridEl.addEventListener('click', e => {
      var card = e.target.closest('.poster-card');
      if (card) activateCard(card);
    });
    gridEl.addEventListener('keydown', e => {
      if (!isTvSelectKey(e)) return;
      var card = e.target.closest('.poster-card');
      if (card) {
        e.preventDefault();
        e.stopPropagation();
        activateCard(card);
      }
    });
  }
  function renderPosterCards(items, container, clear = true) {
    if (clear) container.innerHTML = '';
    if (!items.length && clear) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Пока пусто</div>';
      return;
    }
    if (!items.length) return;
    setupGridDelegation(container);
    var frag = document.createDocumentFragment();
    var _iterator = _createForOfIteratorHelper(items),
      _step;
    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var item = _step.value;
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'poster-card tv-focusable';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', item.title || 'Фильм');
        card.dataset.movieId = String(item.id);
        var posterUrl = item.poster || item.backdrop || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="%23171a29"/></svg>';
        card.innerHTML = `
        <div class="poster-art">
          <img src="${esc(posterUrl)}" loading="lazy" decoding="async" alt="${esc(item.title)}" />
          ${item.vote_average ? `<span class="poster-rating">★ ${esc(item.vote_average)}</span>` : ''}
          <span class="poster-type">${item.type === 'tv' ? 'Сериал' : 'Фильм'}</span>
        </div>
        <div class="poster-title">${esc(item.title)}</div>
        <div class="poster-sub">${esc(item.year || '')}</div>
      `;
        frag.appendChild(card);
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
    container.appendChild(frag);
  }
  document.querySelectorAll('#categoryBar .cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#categoryBar .cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.category = pill.dataset.cat;
      state.searchQuery = '';
      $('globalSearchInput').value = '';
      $('clearSearchBtn').classList.add('hidden');
      loadCatalog(true);
    });
  });
  (_$15 = $('loadMoreCatalogBtn')) === null || _$15 === void 0 || _$15.addEventListener('click', () => {
    if (!catalogLoading && catalogHasMore) {
      state.page++;
      loadCatalog(false);
    }
  });
  var sentinelEl = $('catalogScrollSentinel');
  if (sentinelEl && 'IntersectionObserver' in window) {
    var viewRoot = document.querySelector('.view-container') || null;
    var io = new IntersectionObserver(entries => {
      var entry = entries[0];
      sentinelIntersecting = !!(entry !== null && entry !== void 0 && entry.isIntersecting);
      if (sentinelIntersecting && !catalogLoading && catalogHasMore && state.currentView === 'explore') {
        state.page++;
        loadCatalog(false);
      }
    }, {
      root: viewRoot,
      rootMargin: '700px 0px',
      threshold: 0
    });
    io.observe(sentinelEl);
  }
  var searchTimer = null;
  var searchInput = $('globalSearchInput');
  var clearSearchBtn = $('clearSearchBtn');
  var mainTopbar = $('mainTopbar');
  searchInput.addEventListener('focus', () => {
    mainTopbar.classList.add('search-focused');
    clearSearchBtn.classList.remove('hidden');
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      mainTopbar.classList.remove('search-focused');
      clearSearchBtn.classList.toggle('hidden', !searchInput.value.trim());
    }, 180);
  });
  searchInput.addEventListener('input', e => {
    var val = e.target.value.trim();
    clearSearchBtn.classList.toggle('hidden', !val && document.activeElement !== searchInput);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = val;
      if (state.currentView !== 'explore') switchView('explore');
      loadCatalog(true);
    }, 350);
  });
  $('globalSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    clearTimeout(searchTimer);
    var val = searchInput.value.trim();
    state.searchQuery = val;
    if (state.currentView !== 'explore') switchView('explore');
    loadCatalog(true);
    searchInput.blur();
  });
  clearSearchBtn.addEventListener('click', e => {
    e.preventDefault();
    searchInput.value = '';
    mainTopbar.classList.remove('search-focused');
    clearSearchBtn.classList.add('hidden');
    if (state.searchQuery) {
      state.searchQuery = '';
      loadCatalog(true);
    }
    searchInput.blur();
  });
  function openMovieModal(_x5) {
    return _openMovieModal.apply(this, arguments);
  }
  function _openMovieModal() {
    _openMovieModal = _asyncToGenerator(_regenerator().m(function _callee25(movie) {
      var isBookmarked, det, _t18, _t19;
      return _regenerator().w(function (_context25) {
        while (1) switch (_context25.p = _context25.n) {
          case 0:
            if (movie) {
              _context25.n = 1;
              break;
            }
            return _context25.a(2);
          case 1:
            state.selectedMovie = movie;
            _context25.p = 2;
            if ($('modalBackdrop')) {
              $('modalBackdrop').style.backgroundImage = `url('${movie.backdrop || movie.poster || ''}')`;
            }
            if ($('modalPoster')) {
              $('modalPoster').src = movie.poster || movie.backdrop || '';
              $('modalPoster').alt = movie.title || '';
            }
            if ($('modalType')) $('modalType').textContent = movie.type === 'tv' ? 'Сериал' : 'Фильм';
            if ($('modalRating')) $('modalRating').textContent = movie.vote_average ? `★ ${movie.vote_average}` : '★ —';
            if ($('modalYear')) $('modalYear').textContent = movie.year || '';
            if ($('modalTitle')) $('modalTitle').textContent = movie.title || '';
            if ($('modalOrigTitle')) {
              $('modalOrigTitle').textContent = movie.original_title && movie.original_title !== movie.title ? movie.original_title : '';
            }
            if ($('modalOverview')) $('modalOverview').textContent = movie.overview || 'Описание скоро появится.';
            if ($('modalStartPublicRoomLabel')) {
              $('modalStartPublicRoomLabel').textContent = movie.type === 'tv' ? 'Смотреть сериал' : 'Смотреть фильм';
            }
            isBookmarked = Array.isArray(state.bookmarks) && state.bookmarks.some(m => String(m.id) === String(movie.id));
            updateModalBookmarkUi(isBookmarked);
            if ($('modalPlayInCurrentRoomBtn')) {
              $('modalPlayInCurrentRoomBtn').classList.toggle('hidden', !state.room);
            }
            if ($('modalAddToQueueBtn')) {
              $('modalAddToQueueBtn').classList.toggle('hidden', !state.room);
            }
            $('movieModal').classList.remove('hidden');
            setTimeout(() => {
              var primaryBtn = state.room ? $('modalPlayInCurrentRoomBtn') : $('modalStartPublicRoomBtn');
              if (primaryBtn && !primaryBtn.classList.contains('hidden')) {
                primaryBtn.focus();
              }
            }, 50);
            _context25.p = 3;
            _context25.n = 4;
            return api(`/api/catalog/details?id=${encodeURIComponent(movie.id)}&type=${encodeURIComponent(movie.type || 'movie')}`);
          case 4:
            det = _context25.v;
            if (det.movie && state.selectedMovie && String(state.selectedMovie.id) === String(movie.id)) {
              state.selectedMovie = det.movie;
              if (det.movie.overview && $('modalOverview')) $('modalOverview').textContent = det.movie.overview;
            }
            _context25.n = 6;
            break;
          case 5:
            _context25.p = 5;
            _t18 = _context25.v;
          case 6:
            _context25.n = 8;
            break;
          case 7:
            _context25.p = 7;
            _t19 = _context25.v;
            console.error('openMovieModal error, launching movie directly:', _t19);
            startRoomWithMovie(movie, true);
          case 8:
            return _context25.a(2);
        }
      }, _callee25, null, [[3, 5], [2, 7]]);
    }));
    return _openMovieModal.apply(this, arguments);
  }
  $('modalStartPublicRoomBtn').addEventListener('click', () => {
    if (!state.selectedMovie) return;
    $('movieModal').classList.add('hidden');
    startRoomWithMovie(state.selectedMovie, true);
  });
  $('modalStartPrivateRoomBtn').addEventListener('click', () => {
    if (!state.selectedMovie) return;
    $('movieModal').classList.add('hidden');
    startRoomWithMovie(state.selectedMovie, false);
  });
  $('modalPlayInCurrentRoomBtn').addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee5() {
    return _regenerator().w(function (_context5) {
      while (1) switch (_context5.n) {
        case 0:
          if (!(!state.selectedMovie || !state.room)) {
            _context5.n = 1;
            break;
          }
          return _context5.a(2);
        case 1:
          $('movieModal').classList.add('hidden');
          switchView('room');
          _context5.n = 2;
          return loadZ01ForMovieInRoom(state.selectedMovie, true);
        case 2:
          return _context5.a(2);
      }
    }, _callee5);
  })));
  (_$16 = $('modalAddToQueueBtn')) === null || _$16 === void 0 || _$16.addEventListener('click', () => {
    if (!state.selectedMovie || !state.room) return;
    socket.emit('room:queue_add', {
      movie: state.selectedMovie
    });
    $('movieModal').classList.add('hidden');
  });
  function updateModalBookmarkUi(isBookmarked) {
    var btn = $('modalBookmarkBtn');
    var lbl = $('modalBookmarkLabel');
    var ico = $('modalBookmarkIcon');
    if (btn) btn.classList.toggle('bookmarked', !!isBookmarked);
    if (lbl) lbl.textContent = isBookmarked ? 'В закладках' : 'В закладки';
    if (ico) ico.setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
  }
  $('modalBookmarkBtn').addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee6() {
    var res, _t4, _t5;
    return _regenerator().w(function (_context6) {
      while (1) switch (_context6.p = _context6.n) {
        case 0:
          _context6.n = 1;
          return ensureAuthenticated();
        case 1:
          _t4 = !_context6.v;
          if (_t4) {
            _context6.n = 2;
            break;
          }
          _t4 = !state.selectedMovie;
        case 2:
          if (!_t4) {
            _context6.n = 3;
            break;
          }
          return _context6.a(2);
        case 3:
          _context6.p = 3;
          _context6.n = 4;
          return api('/api/bookmarks/toggle', {
            method: 'POST',
            body: JSON.stringify({
              movie: state.selectedMovie
            })
          });
        case 4:
          res = _context6.v;
          state.bookmarks = res.bookmarks || [];
          updateModalBookmarkUi(res.added);
          if (state.currentView === 'saved') renderSavedGrid();
          showToast(res.added ? 'Добавлено в закладки' : 'Удалено из закладок');
          _context6.n = 6;
          break;
        case 5:
          _context6.p = 5;
          _t5 = _context6.v;
          showToast(_t5.message);
        case 6:
          return _context6.a(2);
      }
    }, _callee6, null, [[3, 5]]);
  })));
  function renderSavedGrid() {
    var bmList = state.bookmarks || [];
    var histList = (state.history || []).map(h => h.movie).filter(Boolean);
    if ($('savedBookmarksCount')) $('savedBookmarksCount').textContent = bmList.length;
    if ($('savedHistoryCount')) $('savedHistoryCount').textContent = histList.length;
    var isBm = state.savedTab === 'bookmarks';
    var list = isBm ? bmList : histList;
    var grid = $('savedGrid');
    if (!grid) return;
    if (!list.length) {
      var _$17;
      grid.innerHTML = `
        <div class="saved-empty-card">
          <div class="saved-empty-ico">
            ${isBm ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'}
          </div>
          <div class="saved-empty-title">${isBm ? 'Закладок пока нет' : 'История просмотров пуста'}</div>
          <div class="saved-empty-sub">${isBm ? 'Сохраняйте фильмы и сериалы в закладки, чтобы быстро вернуться к ним позже' : 'Здесь появятся фильмы и сериалы, которые вы запускали'}</div>
          <button type="button" class="btn primary" id="savedGoExploreBtn">Перейти в каталог</button>
        </div>
      `;
      (_$17 = $('savedGoExploreBtn')) === null || _$17 === void 0 || _$17.addEventListener('click', () => switchView('explore'));
      return;
    }
    renderPosterCards(list, grid, true);
  }
  document.querySelectorAll('[data-saved-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-saved-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.savedTab = btn.dataset.savedTab;
      renderSavedGrid();
    });
  });
  function loadPublicRooms() {
    return _loadPublicRooms.apply(this, arguments);
  }
  function _loadPublicRooms() {
    _loadPublicRooms = _asyncToGenerator(_regenerator().m(function _callee26() {
      var data, _t20;
      return _regenerator().w(function (_context26) {
        while (1) switch (_context26.p = _context26.n) {
          case 0:
            _context26.p = 0;
            _context26.n = 1;
            return api('/api/rooms');
          case 1:
            data = _context26.v;
            renderPublicRooms(data.rooms || []);
            _context26.n = 3;
            break;
          case 2:
            _context26.p = 2;
            _t20 = _context26.v;
          case 3:
            return _context26.a(2);
        }
      }, _callee26, null, [[0, 2]]);
    }));
    return _loadPublicRooms.apply(this, arguments);
  }
  function renderPublicRooms(roomsList) {
    state.publicRooms = roomsList;
    var badge = $('publicRoomsBadge');
    if (roomsList.length > 0) {
      badge.textContent = roomsList.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    var stripWrap = $('liveRoomsStripWrap');
    var strip = $('liveRoomsStrip');
    if (roomsList.length > 0) {
      stripWrap.classList.remove('hidden');
      strip.innerHTML = '';
      roomsList.slice(0, 8).forEach(r => strip.appendChild(createRoomCardEl(r)));
    } else {
      stripWrap.classList.add('hidden');
    }
    var grid = $('publicRoomsGrid');
    grid.innerHTML = '';
    if (roomsList.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-muted);">Сейчас нет открытых комнат. Выберите любой фильм в каталоге или нажмите «+ Создать комнату»!</div>';
      return;
    }
    roomsList.forEach(r => grid.appendChild(createRoomCardEl(r)));
  }
  function createRoomCardEl(r) {
    var _r$media, _r$media2, _r$media3, _r$media4, _r$media5;
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'room-card tv-focusable';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    var bannerImg = ((_r$media = r.media) === null || _r$media === void 0 ? void 0 : _r$media.backdrop) || ((_r$media2 = r.media) === null || _r$media2 === void 0 ? void 0 : _r$media2.poster) || '';
    var avatarsHtml = (r.participants || []).slice(0, 5).map(p => `<span title="${esc(p.displayName)}" style="background:${esc(p.color || 'var(--bg-elevated)')}">${avatarInnerHtml(p)}</span>`).join('');
    var epInfo = (_r$media3 = r.media) !== null && _r$media3 !== void 0 && _r$media3.season && (_r$media4 = r.media) !== null && _r$media4 !== void 0 && _r$media4.episode ? ` · S${r.media.season}E${r.media.episode}` : '';
    var subInfo = (_r$media5 = r.media) !== null && _r$media5 !== void 0 && _r$media5.title ? `${r.media.title}${epInfo}` : 'Выбирают фильм...';
    el.innerHTML = `
      <div class="room-card-banner" style="${bannerImg ? `background-image:url('${esc(bannerImg)}')` : ''}">
        <span class="room-live-pill">LIVE · ${r.participantCount || 1}</span>
      </div>
      <div class="room-card-body">
        <div class="room-card-title">${esc(r.name)}</div>
        <div class="room-card-sub">${esc(subInfo)}</div>
        <div class="room-card-users">
          <div class="avatar-stack">${avatarsHtml}</div>
          <span class="badge tiny accent">Войти →</span>
        </div>
      </div>
    `;
    el.addEventListener('click', () => joinRoomByCode(r.code));
    el.addEventListener('keydown', e => {
      if (isTvSelectKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        joinRoomByCode(r.code);
      }
    });
    return el;
  }
  function startRoomWithMovie(_x6) {
    return _startRoomWithMovie.apply(this, arguments);
  }
  function _startRoomWithMovie() {
    _startRoomWithMovie = _asyncToGenerator(_regenerator().m(function _callee27(movie, isPublic = true) {
      var initialMedia, res, _t21;
      return _regenerator().w(function (_context27) {
        while (1) switch (_context27.p = _context27.n) {
          case 0:
            if (movie) {
              _context27.n = 1;
              break;
            }
            return _context27.a(2);
          case 1:
            showToast(`Запуск фильма «${movie.title || 'Фильм'}»...`);
            _context27.n = 2;
            return ensureAuthenticated();
          case 2:
            if (_context27.v) {
              _context27.n = 3;
              break;
            }
            return _context27.a(2);
          case 3:
            _context27.p = 3;
            initialMedia = {
              type: 'z01',
              title: movie.title,
              poster: movie.poster,
              backdrop: movie.backdrop,
              movie: movie,
              streamUrl: '',
              streamType: 'hls'
            };
            _context27.n = 4;
            return api('/api/rooms', {
              method: 'POST',
              body: JSON.stringify({
                name: movie.title,
                isPublic,
                media: initialMedia
              })
            });
          case 4:
            res = _context27.v;
            _context27.n = 5;
            return joinRoomByCode(res.room.code);
          case 5:
            _context27.n = 7;
            break;
          case 6:
            _context27.p = 6;
            _t21 = _context27.v;
            showToast(_t21.message);
          case 7:
            return _context27.a(2);
        }
      }, _callee27, null, [[3, 6]]);
    }));
    return _startRoomWithMovie.apply(this, arguments);
  }
  $('createCustomRoomBtn').addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee7() {
    var _$18, _$19;
    return _regenerator().w(function (_context7) {
      while (1) switch (_context7.n) {
        case 0:
          _context7.n = 1;
          return ensureAuthenticated();
        case 1:
          if (_context7.v) {
            _context7.n = 2;
            break;
          }
          return _context7.a(2);
        case 2:
          if ($('createRoomNameInput')) {
            $('createRoomNameInput').value = `Комната ${state.user.displayName}`;
          }
          (_$18 = $('createRoomModal')) === null || _$18 === void 0 || _$18.classList.remove('hidden');
          (_$19 = $('createRoomNameInput')) === null || _$19 === void 0 || _$19.focus();
        case 3:
          return _context7.a(2);
      }
    }, _callee7);
  })));
  (_$20 = $('createRoomPrivacySwitch')) === null || _$20 === void 0 || _$20.addEventListener('click', e => {
    var btn = e.target.closest('.proxy-opt-btn');
    if (!btn) return;
    $('createRoomPrivacySwitch').querySelectorAll('.proxy-opt-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
  (_$21 = $('createRoomControlSwitch')) === null || _$21 === void 0 || _$21.addEventListener('click', e => {
    var btn = e.target.closest('.proxy-opt-btn');
    if (!btn) return;
    $('createRoomControlSwitch').querySelectorAll('.proxy-opt-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
  (_$22 = $('createRoomForm')) === null || _$22 === void 0 || _$22.addEventListener('submit', function () {
    var _ref0 = _asyncToGenerator(_regenerator().m(function _callee8(e) {
      var _$23, _$24, _$25, _$26;
      var name, isPublic, hostOnlyControl, res, _t6;
      return _regenerator().w(function (_context8) {
        while (1) switch (_context8.p = _context8.n) {
          case 0:
            e.preventDefault();
            _context8.n = 1;
            return ensureAuthenticated();
          case 1:
            if (_context8.v) {
              _context8.n = 2;
              break;
            }
            return _context8.a(2);
          case 2:
            name = (((_$23 = $('createRoomNameInput')) === null || _$23 === void 0 ? void 0 : _$23.value) || '').trim() || `Комната ${state.user.displayName}`;
            isPublic = ((_$24 = $('createRoomPrivacySwitch')) === null || _$24 === void 0 || (_$24 = _$24.querySelector('.proxy-opt-btn.active')) === null || _$24 === void 0 ? void 0 : _$24.dataset.pub) !== 'false';
            hostOnlyControl = ((_$25 = $('createRoomControlSwitch')) === null || _$25 === void 0 || (_$25 = _$25.querySelector('.proxy-opt-btn.active')) === null || _$25 === void 0 ? void 0 : _$25.dataset.hostonly) === 'true';
            (_$26 = $('createRoomModal')) === null || _$26 === void 0 || _$26.classList.add('hidden');
            _context8.p = 3;
            _context8.n = 4;
            return api('/api/rooms', {
              method: 'POST',
              body: JSON.stringify({
                name,
                isPublic,
                hostOnlyControl
              })
            });
          case 4:
            res = _context8.v;
            _context8.n = 5;
            return joinRoomByCode(res.room.code);
          case 5:
            _context8.n = 7;
            break;
          case 6:
            _context8.p = 6;
            _t6 = _context8.v;
            showToast(_t6.message);
          case 7:
            return _context8.a(2);
        }
      }, _callee8, null, [[3, 6]]);
    }));
    return function (_x7) {
      return _ref0.apply(this, arguments);
    };
  }());
  function joinRoomByCode(_x8) {
    return _joinRoomByCode.apply(this, arguments);
  }
  function _joinRoomByCode() {
    _joinRoomByCode = _asyncToGenerator(_regenerator().m(function _callee28(code) {
      var clean, res, _t22;
      return _regenerator().w(function (_context28) {
        while (1) switch (_context28.p = _context28.n) {
          case 0:
            _context28.n = 1;
            return ensureAuthenticated();
          case 1:
            if (_context28.v) {
              _context28.n = 2;
              break;
            }
            return _context28.a(2);
          case 2:
            clean = String(code || '').trim().toUpperCase();
            if (clean) {
              _context28.n = 3;
              break;
            }
            return _context28.a(2);
          case 3:
            if (!socket.connected) {
              _context28.n = 4;
              break;
            }
            socket.emit('room:join', {
              code: clean,
              token: state.token
            });
            _context28.n = 7;
            break;
          case 4:
            _context28.p = 4;
            _context28.n = 5;
            return api(`/api/rooms/${encodeURIComponent(clean)}/join`, {
              method: 'POST'
            });
          case 5:
            res = _context28.v;
            if (res.room) handleRoomJoined(res.room);
            _context28.n = 7;
            break;
          case 6:
            _context28.p = 6;
            _t22 = _context28.v;
            showToast(_t22.message);
          case 7:
            return _context28.a(2);
        }
      }, _callee28, null, [[4, 6]]);
    }));
    return _joinRoomByCode.apply(this, arguments);
  }
  function leaveRoom() {
    var _state$room2;
    var prevCode = (_state$room2 = state.room) === null || _state$room2 === void 0 ? void 0 : _state$room2.code;
    try {
      sessionStorage.removeItem('active_room_code');
    } catch (_unused13) {}
    try {
      localStorage.removeItem('active_room_code');
    } catch (_unused14) {}
    stopVoiceChat();
    destroyPlayers();
    if (socket && socket.connected) {
      socket.emit('room:leave');
    }
    if (prevCode) {
      api(`/api/rooms/${encodeURIComponent(prevCode)}/leave`, {
        method: 'POST'
      }).catch(() => {});
    }
    state.room = null;
    var url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
    switchView('explore');
  }
  $('leaveRoomBtn').addEventListener('click', leaveRoom);
  $('copyRoomCodeBtn').addEventListener('click', () => {
    if (!state.room) return;
    var shareUrl = `${window.location.origin}/?room=${state.room.code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast(`Ссылка скопирована! Код: ${state.room.code}`);
    }).catch(() => {
      showToast(`Код комнаты: ${state.room.code}`);
    });
  });
  (_$27 = $('joinByCodeBtn')) === null || _$27 === void 0 || _$27.addEventListener('click', () => {
    var _$28, _$29;
    (_$28 = $('joinCodeModal')) === null || _$28 === void 0 || _$28.classList.remove('hidden');
    (_$29 = $('joinCodeInput')) === null || _$29 === void 0 || _$29.focus();
  });
  (_$30 = $('joinCodeForm')) === null || _$30 === void 0 || _$30.addEventListener('submit', e => {
    var _$31;
    e.preventDefault();
    var code = $('joinCodeInput').value.trim().toUpperCase();
    if (!code) return;
    (_$31 = $('joinCodeModal')) === null || _$31 === void 0 || _$31.classList.add('hidden');
    $('joinCodeInput').value = '';
    joinRoomByCode(code);
  });
  function openCustomLinkModal() {
    var _$32, _$33;
    (_$32 = $('customLinkModal')) === null || _$32 === void 0 || _$32.classList.remove('hidden');
    (_$33 = $('customLinkUrl')) === null || _$33 === void 0 || _$33.focus();
  }
  (_$34 = $('customLinkBtn')) === null || _$34 === void 0 || _$34.addEventListener('click', openCustomLinkModal);
  (_$35 = $('openLinkFromRoomBtn')) === null || _$35 === void 0 || _$35.addEventListener('click', openCustomLinkModal);
  (_$36 = $('openCatalogFromRoomBtn')) === null || _$36 === void 0 || _$36.addEventListener('click', () => switchView('explore'));
  function extractYouTubeId(url) {
    var m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function handleLaunchCustomVideo(_x9, _x0) {
    return _handleLaunchCustomVideo.apply(this, arguments);
  }
  function _handleLaunchCustomVideo() {
    _handleLaunchCustomVideo = _asyncToGenerator(_regenerator().m(function _callee29(rawUrl, customTitle) {
      var _$113, _$114;
      var details, movieObj, ytId, isHls, media, res, _t23;
      return _regenerator().w(function (_context29) {
        while (1) switch (_context29.p = _context29.n) {
          case 0:
            _context29.n = 1;
            return ensureAuthenticated();
          case 1:
            if (_context29.v) {
              _context29.n = 2;
              break;
            }
            return _context29.a(2);
          case 2:
            if (rawUrl) {
              _context29.n = 3;
              break;
            }
            return _context29.a(2);
          case 3:
            (_$113 = $('customLinkModal')) === null || _$113 === void 0 || _$113.classList.add('hidden');
            (_$114 = $('authModal')) === null || _$114 === void 0 || _$114.classList.add('hidden');
            if (!/rezka/i.test(rawUrl)) {
              _context29.n = 11;
              break;
            }
            _context29.p = 4;
            setPlayerOverlay(true, true, 'Загружаем HDRezka...');
            _context29.n = 5;
            return api(`/api/rezka/details?url=${encodeURIComponent(rawUrl)}`);
          case 5:
            details = _context29.v;
            movieObj = {
              id: details.id,
              title: details.title,
              original_title: details.origTitle,
              poster: details.poster,
              serial: details.isSeries ? 1 : 0,
              type: details.isSeries ? 'tv' : 'movie'
            };
            if (!state.room) {
              _context29.n = 7;
              break;
            }
            switchView('room');
            _context29.n = 6;
            return loadZ01ForMovieInRoom(movieObj, true);
          case 6:
            _context29.n = 8;
            break;
          case 7:
            _context29.n = 8;
            return startRoomWithMovie(movieObj, true);
          case 8:
            _context29.n = 10;
            break;
          case 9:
            _context29.p = 9;
            _t23 = _context29.v;
            setPlayerOverlay(false, false, '');
            showToast('Не удалось загрузить ссылку HDRezka: ' + _t23.message);
          case 10:
            return _context29.a(2);
          case 11:
            ytId = extractYouTubeId(rawUrl);
            isHls = /\.m3u8(\?|$)/i.test(rawUrl);
            media = {
              type: ytId ? 'youtube' : 'direct',
              title: customTitle,
              streamUrl: rawUrl,
              youtubeId: ytId || '',
              streamType: ytId ? 'youtube' : isHls ? 'hls' : 'mp4'
            };
            if (!state.room) {
              _context29.n = 12;
              break;
            }
            switchView('room');
            socket.emit('room:set_media', {
              media
            });
            if (!socket.connected) {
              api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
                method: 'POST',
                body: JSON.stringify({
                  media
                })
              }).then(r => {
                if (r.room) {
                  state.room = r.room;
                  loadMediaIntoPlayer(r.room.media, r.room.playback);
                }
              }).catch(() => {});
            }
            _context29.n = 14;
            break;
          case 12:
            _context29.n = 13;
            return api('/api/rooms', {
              method: 'POST',
              body: JSON.stringify({
                name: customTitle,
                isPublic: true,
                media
              })
            });
          case 13:
            res = _context29.v;
            _context29.n = 14;
            return joinRoomByCode(res.room.code);
          case 14:
            return _context29.a(2);
        }
      }, _callee29, null, [[4, 9]]);
    }));
    return _handleLaunchCustomVideo.apply(this, arguments);
  }
  (_$37 = $('customLinkForm')) === null || _$37 === void 0 || _$37.addEventListener('submit', function () {
    var _ref1 = _asyncToGenerator(_regenerator().m(function _callee9(e) {
      var rawUrl, customTitle;
      return _regenerator().w(function (_context9) {
        while (1) switch (_context9.n) {
          case 0:
            e.preventDefault();
            rawUrl = $('customLinkUrl').value.trim();
            customTitle = $('customLinkTitle').value.trim() || 'Видео по ссылке';
            $('customLinkUrl').value = '';
            $('customLinkTitle').value = '';
            handleLaunchCustomVideo(rawUrl, customTitle);
          case 1:
            return _context9.a(2);
        }
      }, _callee9);
    }));
    return function (_x1) {
      return _ref1.apply(this, arguments);
    };
  }());
  (_$38 = $('pfolderCustomLinkForm')) === null || _$38 === void 0 || _$38.addEventListener('submit', function () {
    var _ref10 = _asyncToGenerator(_regenerator().m(function _callee0(e) {
      var rawUrl, customTitle;
      return _regenerator().w(function (_context0) {
        while (1) switch (_context0.n) {
          case 0:
            e.preventDefault();
            rawUrl = $('pfolderCustomLinkUrl').value.trim();
            customTitle = $('pfolderCustomLinkTitle').value.trim() || 'Видео по ссылке';
            $('pfolderCustomLinkUrl').value = '';
            $('pfolderCustomLinkTitle').value = '';
            handleLaunchCustomVideo(rawUrl, customTitle);
          case 1:
            return _context0.a(2);
        }
      }, _callee0);
    }));
    return function (_x10) {
      return _ref10.apply(this, arguments);
    };
  }());
  function loadZ01ForMovieInRoom(_x11) {
    return _loadZ01ForMovieInRoom.apply(this, arguments);
  }
  function _loadZ01ForMovieInRoom() {
    _loadZ01ForMovieInRoom = _asyncToGenerator(_regenerator().m(function _callee30(movie, autoBroadcastFirstStream = false) {
      var _state$progress, _state$room10, data, shownSources, firstSource, savedProg, preferredKey, targetSource, _t24;
      return _regenerator().w(function (_context30) {
        while (1) switch (_context30.p = _context30.n) {
          case 0:
            if (movie) {
              _context30.n = 1;
              break;
            }
            return _context30.a(2);
          case 1:
            $('z01Panel').classList.remove('hidden');
            setPlayerOverlay(true, true, `Опрашиваем источники Z01 для «${movie.title}»...`);
            state.z01 = {
              movie,
              uid: '',
              sources: [],
              activeSourceKey: '',
              seasons: [],
              activeSeasonIdx: 0,
              voices: [],
              activeVoiceIdx: 0,
              videos: [],
              activeVideoIdx: 0,
              qualities: {},
              activeQuality: '',
              openDropdown: ''
            };
            renderZ01Panel();
            _context30.p = 2;
            _context30.n = 3;
            return api('/api/z01/sources', {
              method: 'POST',
              body: JSON.stringify({
                movie
              })
            });
          case 3:
            data = _context30.v;
            state.z01.movie = data.movie || movie;
            state.z01.uid = data.uid || '';
            state.z01.sources = data.sources || [];
            shownSources = state.z01.sources.filter(s => s.show);
            firstSource = shownSources[0] || state.z01.sources[0];
            if (firstSource) {
              _context30.n = 4;
              break;
            }
            setPlayerOverlay(true, false, 'Источники Z01 не найдены для этого названия');
            renderZ01Panel();
            return _context30.a(2);
          case 4:
            savedProg = (_state$progress = state.progress) === null || _state$progress === void 0 ? void 0 : _state$progress[String(movie.id)];
            preferredKey = ((_state$room10 = state.room) === null || _state$room10 === void 0 || (_state$room10 = _state$room10.media) === null || _state$room10 === void 0 ? void 0 : _state$room10.balancerKey) || (savedProg === null || savedProg === void 0 ? void 0 : savedProg.balancerKey);
            targetSource = state.z01.sources.find(s => s.key === preferredKey) || firstSource;
            _context30.n = 5;
            return selectZ01Balancer(targetSource.key, autoBroadcastFirstStream);
          case 5:
            _context30.n = 7;
            break;
          case 6:
            _context30.p = 6;
            _t24 = _context30.v;
            setPlayerOverlay(true, false, `Ошибка Z01: ${_t24.message}`);
          case 7:
            return _context30.a(2);
        }
      }, _callee30, null, [[2, 6]]);
    }));
    return _loadZ01ForMovieInRoom.apply(this, arguments);
  }
  function selectZ01Balancer(_x12) {
    return _selectZ01Balancer.apply(this, arguments);
  }
  function _selectZ01Balancer() {
    _selectZ01Balancer = _asyncToGenerator(_regenerator().m(function _callee31(sourceKey, autoPlay = true) {
      var src, _bData$videos, bData, nextCandidate, prefVoice, _state$z01$videos$, matchVIdx, matchVidIdx, _t25;
      return _regenerator().w(function (_context31) {
        while (1) switch (_context31.p = _context31.n) {
          case 0:
            src = state.z01.sources.find(s => s.key === sourceKey);
            if (src) {
              _context31.n = 1;
              break;
            }
            return _context31.a(2);
          case 1:
            state.z01.activeSourceKey = src.key;
            state.z01.openDropdown = '';
            setPlayerOverlay(true, true, `Загрузка «${src.name}»...`);
            renderZ01Panel();
            _context31.p = 2;
            _context31.n = 3;
            return api('/api/z01/balancer', {
              method: 'POST',
              body: JSON.stringify({
                url: src.url,
                movie: state.z01.movie,
                uid: state.z01.uid
              })
            });
          case 3:
            bData = _context31.v;
            if (!(bData.error || !((_bData$videos = bData.videos) !== null && _bData$videos !== void 0 && _bData$videos.length))) {
              _context31.n = 5;
              break;
            }
            nextCandidate = state.z01.sources.find(s => s.show && s.key !== src.key && !s._tried);
            src._tried = true;
            if (!nextCandidate) {
              _context31.n = 4;
              break;
            }
            showToast(`Источник ${src.name} пуст, переключаем на ${nextCandidate.name}...`);
            return _context31.a(2, selectZ01Balancer(nextCandidate.key, autoPlay));
          case 4:
            setPlayerOverlay(true, false, bData.error || `Источник ${src.name} не вернул видео. Выберите другой источник.`);
            renderZ01Panel();
            return _context31.a(2);
          case 5:
            state.z01.seasons = bData.seasons || [];
            state.z01.voices = bData.voices || [];
            state.z01.videos = bData.videos || [];
            state.z01.activeSeasonIdx = Math.max(0, state.z01.seasons.findIndex(s => s.active));
            state.z01.activeVoiceIdx = Math.max(0, state.z01.voices.findIndex(v => v.active));
            state.z01.activeVideoIdx = 0;
            prefVoice = (localStorage.getItem('oulo_preferred_voice') || '').trim().toLowerCase();
            if (!prefVoice) {
              _context31.n = 8;
              break;
            }
            if (!(state.z01.voices.length > 1)) {
              _context31.n = 7;
              break;
            }
            matchVIdx = state.z01.voices.findIndex(v => (v.title || '').toLowerCase().includes(prefVoice));
            if (!(matchVIdx >= 0 && matchVIdx !== state.z01.activeVoiceIdx && state.z01.voices[matchVIdx].url)) {
              _context31.n = 6;
              break;
            }
            renderZ01Panel();
            return _context31.a(2, queryZ01SubUrl(state.z01.voices[matchVIdx].url, 'voice', matchVIdx));
          case 6:
            _context31.n = 8;
            break;
          case 7:
            if (state.z01.videos.length > 1 && !state.z01.seasons.length && !((_state$z01$videos$ = state.z01.videos[0]) !== null && _state$z01$videos$ !== void 0 && _state$z01$videos$.episode)) {
              matchVidIdx = state.z01.videos.findIndex(v => (v.voice_name || v.title || '').toLowerCase().includes(prefVoice));
              if (matchVidIdx >= 0) {
                state.z01.activeVideoIdx = matchVidIdx;
              }
            }
          case 8:
            renderZ01Panel();
            if (!(autoPlay && state.z01.videos[state.z01.activeVideoIdx])) {
              _context31.n = 10;
              break;
            }
            _context31.n = 9;
            return selectZ01VideoItem(state.z01.activeVideoIdx, true);
          case 9:
            _context31.n = 11;
            break;
          case 10:
            setPlayerOverlay(false, false, '');
          case 11:
            _context31.n = 13;
            break;
          case 12:
            _context31.p = 12;
            _t25 = _context31.v;
            setPlayerOverlay(true, false, `Ошибка балансера ${src.name}: ${_t25.message}`);
          case 13:
            return _context31.a(2);
        }
      }, _callee31, null, [[2, 12]]);
    }));
    return _selectZ01Balancer.apply(this, arguments);
  }
  function queryZ01SubUrl(_x13, _x14, _x15) {
    return _queryZ01SubUrl.apply(this, arguments);
  }
  function _queryZ01SubUrl() {
    _queryZ01SubUrl = _asyncToGenerator(_regenerator().m(function _callee32(url, type, index) {
      var _bData$seasons, _bData$voices, _bData$videos2, bData, _t26;
      return _regenerator().w(function (_context32) {
        while (1) switch (_context32.p = _context32.n) {
          case 0:
            state.z01.openDropdown = '';
            setPlayerOverlay(true, true, 'Обновляем список...');
            _context32.p = 1;
            _context32.n = 2;
            return api('/api/z01/balancer', {
              method: 'POST',
              body: JSON.stringify({
                url,
                movie: state.z01.movie,
                uid: state.z01.uid
              })
            });
          case 2:
            bData = _context32.v;
            if ((_bData$seasons = bData.seasons) !== null && _bData$seasons !== void 0 && _bData$seasons.length) state.z01.seasons = bData.seasons;
            if ((_bData$voices = bData.voices) !== null && _bData$voices !== void 0 && _bData$voices.length) state.z01.voices = bData.voices;
            if ((_bData$videos2 = bData.videos) !== null && _bData$videos2 !== void 0 && _bData$videos2.length) state.z01.videos = bData.videos;
            if (type === 'season') state.z01.activeSeasonIdx = index;
            if (type === 'voice') state.z01.activeVoiceIdx = index;
            state.z01.activeVideoIdx = 0;
            renderZ01Panel();
            if (!state.z01.videos[0]) {
              _context32.n = 3;
              break;
            }
            _context32.n = 3;
            return selectZ01VideoItem(0, true);
          case 3:
            _context32.n = 5;
            break;
          case 4:
            _context32.p = 4;
            _t26 = _context32.v;
            showToast(_t26.message);
            setPlayerOverlay(false, false, '');
          case 5:
            return _context32.a(2);
        }
      }, _callee32, null, [[1, 4]]);
    }));
    return _queryZ01SubUrl.apply(this, arguments);
  }
  function selectZ01VideoItem(_x16) {
    return _selectZ01VideoItem.apply(this, arguments);
  }
  function _selectZ01VideoItem() {
    _selectZ01VideoItem = _asyncToGenerator(_regenerator().m(function _callee33(videoIndex, broadcastToRoom = true) {
      var item, _state$z01$movie, _state$z01$movie2, _state$z01$movie3, _state$z01$voices$sta, resolved, rawQualities, sortedQKeys, sortedQualities, prefQuality, matchedQ, needsProxy, activeSource, streamUrl, isHlsResolved, newMedia, _t27;
      return _regenerator().w(function (_context33) {
        while (1) switch (_context33.p = _context33.n) {
          case 0:
            item = state.z01.videos[videoIndex];
            if (item) {
              _context33.n = 1;
              break;
            }
            return _context33.a(2);
          case 1:
            state.z01.activeVideoIdx = videoIndex;
            renderZ01Panel();
            setPlayerOverlay(true, true, 'Извлекаем поток видео...');
            _context33.p = 2;
            _context33.n = 3;
            return api('/api/z01/resolve', {
              method: 'POST',
              body: JSON.stringify({
                url: item.url,
                method: item.method,
                headers: item.headers,
                qualities: item.qualities,
                subtitles: item.subtitles,
                uid: state.z01.uid
              })
            });
          case 3:
            resolved = _context33.v;
            rawQualities = resolved.proxiedQualities || {};
            sortedQKeys = sortQualityKeys(Object.keys(rawQualities));
            sortedQualities = {};
            sortedQKeys.forEach(k => {
              sortedQualities[k] = rawQualities[k];
            });
            state.z01.qualities = sortedQualities;
            prefQuality = localStorage.getItem('oulo_preferred_quality') || '';
            matchedQ = prefQuality && sortedQKeys.find(k => k.toLowerCase() === prefQuality.toLowerCase()) || sortedQKeys[0] || item.quality || 'Auto';
            state.z01.activeQuality = matchedQ;
            needsProxy = resolved.recommendedUrl === resolved.proxyUrl;
            if (state.z01.qualities[matchedQ]) {
              resolved.url = state.z01.qualities[matchedQ].raw || resolved.url;
              resolved.proxyUrl = state.z01.qualities[matchedQ].proxy || resolved.proxyUrl;
              resolved.recommendedUrl = state.proxyMode === 'off' ? resolved.url : needsProxy ? resolved.proxyUrl || resolved.url : resolved.url;
            }
            renderZ01Panel();
            activeSource = state.z01.sources.find(s => s.key === state.z01.activeSourceKey);
            streamUrl = pickStreamUrl(resolved);
            isHlsResolved = /\.m3u8(\?|$)/i.test(resolved.url || '') || String(resolved.url || '').includes('manifest.m3u8');
            newMedia = {
              type: 'z01',
              title: ((_state$z01$movie = state.z01.movie) === null || _state$z01$movie === void 0 ? void 0 : _state$z01$movie.title) || item.title,
              poster: ((_state$z01$movie2 = state.z01.movie) === null || _state$z01$movie2 === void 0 ? void 0 : _state$z01$movie2.poster) || '',
              backdrop: ((_state$z01$movie3 = state.z01.movie) === null || _state$z01$movie3 === void 0 ? void 0 : _state$z01$movie3.backdrop) || '',
              movie: state.z01.movie,
              balancerKey: state.z01.activeSourceKey,
              balancerName: activeSource ? activeSource.name : state.z01.activeSourceKey,
              season: item.season || (state.z01.seasons[state.z01.activeSeasonIdx] ? state.z01.activeSeasonIdx + 1 : 0),
              episode: item.episode || 0,
              voiceName: item.voice_name || ((_state$z01$voices$sta = state.z01.voices[state.z01.activeVoiceIdx]) === null || _state$z01$voices$sta === void 0 ? void 0 : _state$z01$voices$sta.title) || '',
              quality: state.z01.activeQuality,
              qualities: state.z01.qualities,
              needsProxy,
              rawUrl: resolved.url,
              proxyUrl: resolved.proxyUrl,
              recommendedUrl: resolved.recommendedUrl,
              streamUrl,
              streamType: isHlsResolved ? 'hls' : resolved.streamType || 'hls',
              subtitles: resolved.subtitles || []
            };
            if (state.user && state.z01.movie) {
              api('/api/history', {
                method: 'POST',
                body: JSON.stringify({
                  movie: state.z01.movie,
                  balancerKey: newMedia.balancerKey,
                  balancer: newMedia.balancerName,
                  season: newMedia.season,
                  episode: newMedia.episode,
                  voiceName: newMedia.voiceName
                })
              }).then(r => {
                if (r.history) state.history = r.history;
                if (r.progress) state.progress = r.progress;
              }).catch(() => {});
            }
            if (broadcastToRoom && state.room) {
              socket.emit('room:set_media', {
                media: newMedia
              });
              if (!socket.connected) {
                api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
                  method: 'POST',
                  body: JSON.stringify({
                    media: newMedia
                  })
                }).catch(() => {});
                loadMediaIntoPlayer(newMedia, {
                  playing: true,
                  currentTime: 0
                });
              }
            } else {
              loadMediaIntoPlayer(newMedia, {
                playing: true,
                currentTime: 0
              });
            }
            _context33.n = 5;
            break;
          case 4:
            _context33.p = 4;
            _t27 = _context33.v;
            setPlayerOverlay(true, false, `Ошибка потока: ${_t27.message}. Попробуйте другой источник Z01.`);
          case 5:
            return _context33.a(2);
        }
      }, _callee33, null, [[2, 4]]);
    }));
    return _selectZ01VideoItem.apply(this, arguments);
  }
  function sortQualityKeys(keys) {
    var rank = k => {
      var s = String(k || '').toLowerCase();
      if (s.includes('2160') || s.includes('4k')) return 2160;
      if (s.includes('1440') || s.includes('2k')) return 1440;
      if (s.includes('1080') || s.includes('fhd')) return 1080;
      if (s.includes('720') || s.includes('hd')) return 720;
      if (s.includes('480')) return 480;
      if (s.includes('360')) return 360;
      if (s.includes('240')) return 240;
      if (s.includes('auto') || s.includes('авто')) return 1;
      return parseInt(s, 10) || 0;
    };
    return [...keys].sort((a, b) => rank(b) - rank(a));
  }
  function pickStreamUrl(mediaOrResolved) {
    if (!mediaOrResolved) return '';
    if (state.proxyMode === 'always' && mediaOrResolved.proxyUrl) return mediaOrResolved.proxyUrl;
    if (state.proxyMode === 'off' && mediaOrResolved.rawUrl) return mediaOrResolved.rawUrl;
    return mediaOrResolved.recommendedUrl || mediaOrResolved.streamUrl || mediaOrResolved.rawUrl || '';
  }
  function renderZ01Panel() {
    var _videos$;
    var segBox = $('z01Segments');
    var dropGrid = $('z01DropdownGrid');
    var epStrip = $('z01EpisodesStrip');
    segBox.innerHTML = '';
    dropGrid.innerHTML = '';
    var _state$z = state.z01,
      sources = _state$z.sources,
      activeSourceKey = _state$z.activeSourceKey,
      seasons = _state$z.seasons,
      activeSeasonIdx = _state$z.activeSeasonIdx,
      voices = _state$z.voices,
      activeVoiceIdx = _state$z.activeVoiceIdx,
      videos = _state$z.videos,
      activeVideoIdx = _state$z.activeVideoIdx,
      qualities = _state$z.qualities,
      activeQuality = _state$z.activeQuality,
      openDropdown = _state$z.openDropdown;
    if (!sources.length) {
      dropGrid.classList.add('hidden');
      epStrip.classList.add('hidden');
      return;
    }
    var activeSrc = sources.find(s => s.key === activeSourceKey) || sources[0];
    var addSegment = (key, label, value, badge = '') => {
      var seg = document.createElement('div');
      seg.className = `z01-seg ${openDropdown === key ? 'open' : ''}`;
      seg.innerHTML = `
        <div class="z01-seg-top">
          <span class="z01-seg-label">${esc(label)}</span>
          <svg class="z01-seg-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="z01-seg-val">
          ${badge ? `<span class="z01-tag">${esc(badge)}</span>` : ''}
          <span>${esc(value)}</span>
        </div>
      `;
      seg.addEventListener('click', () => {
        state.z01.openDropdown = state.z01.openDropdown === key ? '' : key;
        renderZ01Panel();
      });
      segBox.appendChild(seg);
    };
    var z01Sources = sources.filter(s => s.key !== 'hdrezka');
    var rezkaSource = sources.find(s => s.key === 'hdrezka');
    var isRezkaActive = activeSourceKey === 'hdrezka';
    var activeZ01 = z01Sources.find(s => s.key === activeSourceKey) || z01Sources[0];
    var z01Seg = document.createElement('div');
    z01Seg.className = `z01-seg ${!isRezkaActive ? 'active' : ''} ${openDropdown === 'source' ? 'open' : ''}`;
    z01Seg.innerHTML = `
      <div class="z01-seg-top">
        <span class="z01-seg-label">Источник Z01</span>
        <svg class="z01-seg-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="z01-seg-val">
        ${activeZ01 !== null && activeZ01 !== void 0 && activeZ01.badge ? `<span class="z01-tag">${esc(activeZ01.badge)}</span>` : ''}
        <span>${esc(activeZ01 ? activeZ01.name : 'Z01')}</span>
      </div>
    `;
    z01Seg.addEventListener('click', () => {
      if (isRezkaActive) {
        state.z01.openDropdown = '';
        if (activeZ01) selectZ01Balancer(activeZ01.key, true);
      } else {
        state.z01.openDropdown = state.z01.openDropdown === 'source' ? '' : 'source';
        renderZ01Panel();
      }
    });
    segBox.appendChild(z01Seg);
    if (rezkaSource) {
      var rezkaSeg = document.createElement('div');
      rezkaSeg.className = `z01-seg ${isRezkaActive ? 'active' : ''}`;
      rezkaSeg.innerHTML = `
        <span class="z01-seg-label">HDRezka</span>
        <div class="z01-seg-val">
          <span class="z01-tag">${esc(rezkaSource.badge || 'FHD')}</span>
          <span>HDRezka</span>
        </div>
      `;
      rezkaSeg.addEventListener('click', () => {
        if (!isRezkaActive) {
          state.z01.openDropdown = '';
          selectZ01Balancer('hdrezka', true);
        }
      });
      segBox.appendChild(rezkaSeg);
    }
    if (seasons.length > 1) {
      var curS = seasons[activeSeasonIdx] || seasons[0];
      addSegment('season', 'Сезон', curS.title);
    }
    if (voices.length >= 1) {
      var curV = voices[activeVoiceIdx] || voices[0];
      addSegment('voice', 'Озвучка', curV.title, curV.groupTitle);
    } else if (videos.length > 1 && !seasons.length && !((_videos$ = videos[0]) !== null && _videos$ !== void 0 && _videos$.episode)) {
      var curItem = videos[activeVideoIdx] || videos[0];
      addSegment('movie_voice', 'Перевод', curItem.voice_name || curItem.title, curItem.quality);
    }
    var qKeys = Object.keys(qualities || {});
    if (qKeys.length > 1) {
      addSegment('quality', 'Качество', activeQuality || qKeys[0]);
    }
    if (openDropdown === 'source') {
      dropGrid.classList.remove('hidden');
      z01Sources.forEach(s => {
        var btn = document.createElement('button');
        btn.className = `z01-opt ${s.key === activeSourceKey ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${s.badge ? `<span class="z01-tag">${esc(s.badge)}</span> ` : ''}${esc(s.name)}</div>
          <div class="z01-opt-note">${s.show ? 'Онлайн' : 'Доп. источник'}</div>
        `;
        btn.onclick = () => selectZ01Balancer(s.key, true);
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'season') {
      dropGrid.classList.remove('hidden');
      seasons.forEach((s, idx) => {
        var btn = document.createElement('button');
        btn.className = `z01-opt ${idx === activeSeasonIdx ? 'active' : ''}`;
        btn.innerHTML = `<div class="z01-opt-title">${esc(s.title)}</div>`;
        btn.onclick = () => queryZ01SubUrl(s.url, 'season', idx);
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'voice') {
      dropGrid.classList.remove('hidden');
      voices.forEach((v, idx) => {
        var btn = document.createElement('button');
        btn.className = `z01-opt ${idx === activeVoiceIdx ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${esc(v.title)}</div>
          <div class="z01-opt-note">${esc(v.groupTitle || '')}</div>
        `;
        btn.onclick = () => {
          if (v.title) localStorage.setItem('oulo_preferred_voice', v.title);
          queryZ01SubUrl(v.url, 'voice', idx);
        };
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'movie_voice') {
      dropGrid.classList.remove('hidden');
      videos.forEach((v, idx) => {
        var btn = document.createElement('button');
        btn.className = `z01-opt ${idx === activeVideoIdx ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${esc(v.voice_name || v.title)}</div>
          <div class="z01-opt-note">${esc(v.quality || '')}</div>
        `;
        btn.onclick = () => {
          var vName = v.voice_name || v.title || '';
          if (vName) localStorage.setItem('oulo_preferred_voice', vName);
          state.z01.openDropdown = '';
          selectZ01VideoItem(idx, true);
        };
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'quality') {
      dropGrid.classList.remove('hidden');
      qKeys.forEach(qk => {
        var btn = document.createElement('button');
        btn.className = `z01-opt ${qk === activeQuality ? 'active' : ''}`;
        btn.innerHTML = `<div class="z01-opt-title">${esc(qk)}</div>`;
        btn.onclick = () => {
          localStorage.setItem('oulo_preferred_quality', qk);
          state.z01.activeQuality = qk;
          state.z01.openDropdown = '';
          var qObj = qualities[qk];
          if (qObj) {
            if (typeof qObj.hlsLevel === 'number' && state.hls) {
              state.hls.currentLevel = qObj.hlsLevel;
              state.hls.nextLevel = qObj.hlsLevel;
              if (state.room && state.room.media) state.room.media.quality = qk;
              showToast(`Качество: ${qk}`);
            } else if (qObj.raw && state.room && state.room.media) {
              var video = $('mainVideo');
              var currentTime = video.currentTime || 0;
              var wasPlaying = !video.paused;
              var needsProxy = state.room.media.needsProxy !== undefined ? state.room.media.needsProxy : state.room.media.recommendedUrl === state.room.media.proxyUrl;
              var nextRecommended = needsProxy ? qObj.proxy || qObj.raw : qObj.raw;
              var isHlsUrl = /\.m3u8(\?|$)/i.test(qObj.raw) || String(qObj.raw).includes('manifest.m3u8');
              state.room.media.rawUrl = qObj.raw;
              state.room.media.proxyUrl = qObj.proxy;
              state.room.media.recommendedUrl = nextRecommended;
              state.room.media.quality = qk;
              state.room.media.streamType = isHlsUrl ? 'hls' : 'mp4';
              state.room.media.streamUrl = pickStreamUrl(state.room.media);
              loadMediaIntoPlayer(state.room.media, {
                playing: wasPlaying,
                currentTime
              });
              showToast(`Качество: ${qk}`);
            }
          }
          renderZ01Panel();
        };
        dropGrid.appendChild(btn);
      });
    } else {
      dropGrid.classList.add('hidden');
    }
    var isSeriesEpisodes = videos.length > 1 && (seasons.length > 0 || videos.some(v => v.episode > 0));
    if ($('mobileZ01TabLabel')) {
      $('mobileZ01TabLabel').textContent = isSeriesEpisodes ? 'Озвучка и серии' : 'Озвучка';
    }
    var tvSrcLbl = document.querySelector('#tvSourceBtn .tv-ctrl-lbl');
    if (tvSrcLbl) {
      tvSrcLbl.textContent = isSeriesEpisodes ? 'Озвучка и серии' : 'Озвучка';
    }
    if (isSeriesEpisodes) {
      epStrip.classList.remove('hidden');
      epStrip.innerHTML = '';
      videos.forEach((v, idx) => {
        var epBtn = document.createElement('button');
        epBtn.className = `ep-btn ${idx === activeVideoIdx ? 'active' : ''}`;
        var epNum = v.episode || idx + 1;
        epBtn.innerHTML = `
          <span class="ep-num">${epNum < 10 ? '0' + epNum : epNum} серия</span>
          <span class="ep-sub">${esc(v.quality || v.voice_name || '')}</span>
        `;
        epBtn.onclick = () => selectZ01VideoItem(idx, true);
        epStrip.appendChild(epBtn);
      });
    } else {
      epStrip.classList.add('hidden');
    }
  }
  function toggleProxyStreamMode() {
    var modes = ['auto', 'always', 'off'];
    var labels = {
      auto: 'Прокси: Авто',
      always: 'Прокси: Вкл',
      off: 'Прокси: Выкл'
    };
    var nextIdx = (modes.indexOf(state.proxyMode) + 1) % modes.length;
    state.proxyMode = modes[nextIdx];
    document.querySelectorAll('.btn-toggle-proxy, #toggleProxyStreamBtn').forEach(btn => {
      var span = btn.querySelector('span');
      if (span) span.textContent = labels[state.proxyMode];else btn.textContent = labels[state.proxyMode];
    });
    if (state.user) {
      api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            proxyMode: state.proxyMode
          }
        })
      }).catch(() => {});
    }
    if (state.room && state.room.media && state.room.media.rawUrl) {
      var video = $('mainVideo');
      var curTime = video.currentTime || 0;
      var wasPlaying = !video.paused;
      state.room.media.streamUrl = pickStreamUrl(state.room.media);
      loadMediaIntoPlayer(state.room.media, {
        playing: wasPlaying,
        currentTime: curTime
      });
    }
    showToast(`Режим потока: ${labels[state.proxyMode]}`);
  }
  document.querySelectorAll('.btn-toggle-proxy, #toggleProxyStreamBtn').forEach(btn => {
    btn.addEventListener('click', toggleProxyStreamMode);
  });
  function setPlayerOverlay(visible, loading = false, text = '') {
    var ov = $('playerEmptyOverlay');
    var sp = $('playerLoadingSpinner');
    var txt = $('playerStatusText');
    ov.classList.toggle('hidden', !visible);
    sp.classList.toggle('hidden', !loading);
    if (text) txt.textContent = text;
  }
  function destroyPlayers() {
    state.loadedStreamKey = '';
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    var video = $('mainVideo');
    video.pause();
    video.removeAttribute('src');
    video.load();
    $('youtubeContainer').innerHTML = '';
    $('youtubeContainer').classList.add('hidden');
    video.classList.remove('hidden');
  }
  function loadMediaIntoPlayer(media, playback = {
    playing: true,
    currentTime: 0
  }) {
    destroyPlayers();
    state.loadedStreamKey = (media === null || media === void 0 ? void 0 : media.streamUrl) || (media === null || media === void 0 ? void 0 : media.youtubeId) || '';
    $('unmuteSyncBtn').classList.add('hidden');
    if (!media || !media.streamUrl && !media.youtubeId) {
      setPlayerOverlay(true, false, 'Выберите фильм из каталога или источник Z01 ниже');
      return;
    }
    setPlayerOverlay(false, false, '');
    var video = $('mainVideo');
    video.controls = window.innerWidth <= 900;
    state.justLoadedMediaUntil = Date.now() + 2600;
    if (media.qualities && Object.keys(media.qualities).length > 0 && (!state.z01.qualities || Object.keys(state.z01.qualities).length === 0)) {
      state.z01.qualities = media.qualities;
      state.z01.activeQuality = media.quality || Object.keys(media.qualities)[0] || '';
      renderZ01Panel();
    }
    var epTag = media.season && media.episode ? ` · Сезон ${media.season}, Серия ${media.episode}` : '';
    var balTag = media.balancerName ? ` [${media.balancerName}]` : '';
    var voiceTag = media.voiceName ? ` · ${media.voiceName}` : '';
    $('roomSubText').textContent = `${media.title || 'Видео'}${epTag}${voiceTag}${balTag}`;
    if (media.streamType === 'youtube' || media.youtubeId) {
      video.classList.add('hidden');
      var ytBox = $('youtubeContainer');
      ytBox.classList.remove('hidden');
      var ytId = media.youtubeId || extractYouTubeId(media.streamUrl);
      var startSec = Math.floor(playback.currentTime || 0);
      ytBox.innerHTML = `<iframe src="https://www.youtube.com/embed/${esc(ytId)}?autoplay=${playback.playing ? 1 : 0}&start=${startSec}&enablejsapi=1&rel=0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
      return;
    }
    var streamUrl = pickStreamUrl(media);
    var isHls = media.streamType === 'hls' || /\.m3u8(\?|$)/i.test(streamUrl);
    var tryAutoplaySynced = () => {
      if (!playback.playing) return;
      video.play().then(() => {
        $('unmuteSyncBtn').classList.toggle('hidden', !video.muted);
      }).catch(() => {
        video.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        video.play().catch(() => {
          showToast('Нажмите Play на плеере для синхронного запуска');
        });
      });
    };
    var onLoaded = () => {
      state.suppressSyncEmit = true;
      state.justLoadedMediaUntil = Date.now() + 2200;
      if (playback.currentTime && Math.abs(video.currentTime - playback.currentTime) > 1.0) {
        try {
          video.currentTime = playback.currentTime;
        } catch (_unused15) {}
      }
      tryAutoplaySynced();
      setTimeout(() => {
        state.suppressSyncEmit = false;
        if (state.room) socket.emit('player:request_sync');
      }, 650);
    };
    if (isHls && window.Hls && window.Hls.isSupported()) {
      var hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 45,
        maxMaxBufferLength: 120,
        maxBufferSize: 60 * 1000 * 1000,
        backBufferLength: 20,
        maxBufferHole: 0.6,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        manifestLoadingTimeOut: 12000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 5
      });
      state.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        var _state$z01$qualities$;
        var existingQKeys = Object.keys(state.z01.qualities || {});
        var hasUrlMap = existingQKeys.length > 1 && ((_state$z01$qualities$ = state.z01.qualities[existingQKeys[0]]) === null || _state$z01$qualities$ === void 0 ? void 0 : _state$z01$qualities$.raw);
        if (!hasUrlMap && Array.isArray(hls.levels) && hls.levels.length > 1) {
          var levelMap = {};
          hls.levels.forEach((lvl, idx) => {
            var _lvl$attrs$RESOLUTION;
            var h = lvl.height || lvl.attrs && parseInt((_lvl$attrs$RESOLUTION = lvl.attrs.RESOLUTION) === null || _lvl$attrs$RESOLUTION === void 0 ? void 0 : _lvl$attrs$RESOLUTION.split('x')[1], 10) || 0;
            var label = h ? `${h}p` : `Уровень ${idx + 1}`;
            levelMap[label] = {
              hlsLevel: idx
            };
          });
          var sortedLabels = sortQualityKeys(Object.keys(levelMap));
          var orderedMap = {};
          sortedLabels.forEach(k => {
            orderedMap[k] = levelMap[k];
          });
          orderedMap['Авто'] = {
            hlsLevel: -1
          };
          state.z01.qualities = orderedMap;
          var prefQ = localStorage.getItem('oulo_preferred_quality') || '';
          var matchKey = prefQ && Object.keys(orderedMap).find(k => k.toLowerCase() === prefQ.toLowerCase()) || sortedLabels[0] || 'Авто';
          state.z01.activeQuality = matchKey;
          if (orderedMap[matchKey] && typeof orderedMap[matchKey].hlsLevel === 'number') {
            hls.currentLevel = orderedMap[matchKey].hlsLevel;
          }
          renderZ01Panel();
        }
        onLoaded();
      });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS network error, attempting auto-recovery...', data.details);
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS media error, attempting auto-recovery...', data.details);
              hls.recoverMediaError();
              break;
            default:
              if (media.proxyUrl && streamUrl !== media.proxyUrl) {
                console.log('Direct HLS unrecoverable, falling back to backend stream proxy...');
                media.recommendedUrl = media.proxyUrl;
                media.streamUrl = media.proxyUrl;
                hls.loadSource(media.proxyUrl);
              } else {
                hls.destroy();
                tryFallbackToNextBalancer();
              }
              break;
          }
        }
      });
    } else {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', onLoaded, {
        once: true
      });
      video.addEventListener('error', () => {
        if (media.proxyUrl && video.src !== new URL(media.proxyUrl, window.location.origin).href) {
          media.recommendedUrl = media.proxyUrl;
          media.streamUrl = media.proxyUrl;
          video.src = media.proxyUrl;
          video.load();
        } else {
          tryFallbackToNextBalancer();
        }
      }, {
        once: true
      });
    }
  }
  function tryFallbackToNextBalancer() {
    if (!state.z01 || !Array.isArray(state.z01.sources) || !state.z01.sources.length) return;
    var curSrc = state.z01.sources.find(s => s.key === state.z01.activeSourceKey);
    if (curSrc) curSrc._tried = true;
    var nextCandidate = state.z01.sources.find(s => s.show && s.key !== state.z01.activeSourceKey && !s._tried);
    if (nextCandidate) {
      showToast(`Поток недоступен, переключаем на ${nextCandidate.name}...`);
      selectZ01Balancer(nextCandidate.key, true);
    }
  }
  $('unmuteSyncBtn').addEventListener('click', () => {
    var video = $('mainVideo');
    video.muted = false;
    $('unmuteSyncBtn').classList.add('hidden');
    video.play().catch(() => {});
    socket.emit('player:request_sync');
  });
  var mainVideo = $('mainVideo');
  function emitPlayerSync(action, extra = {}) {
    var _state$room3;
    if (!state.room || state.suppressSyncEmit) return;
    if (!state.room.media || state.room.media.streamType === 'youtube') return;
    if (Date.now() < state.justLoadedMediaUntil && (mainVideo.currentTime || 0) < 2 && action !== 'seek' && action !== 'remote') {
      socket.emit('player:request_sync');
      return;
    }
    var now = Date.now();
    if (action === 'timeupdate' && now - state.lastSyncAt < 3000) return;
    state.lastSyncAt = now;
    var payload = _objectSpread({
      action,
      playing: typeof extra.playing === 'boolean' ? extra.playing : !mainVideo.paused,
      currentTime: typeof extra.currentTime === 'number' ? extra.currentTime : mainVideo.currentTime || 0,
      rate: mainVideo.playbackRate || 1,
      clientId: state.clientId
    }, extra);
    if (socket.connected) {
      socket.emit('player:sync', payload);
    } else {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }).then(res => {
        var _res$room;
        if (res !== null && res !== void 0 && (_res$room = res.room) !== null && _res$room !== void 0 && (_res$room = _res$room.playback) !== null && _res$room !== void 0 && _res$room.lastActionId) {
          state.lastAppliedActionId = res.room.playback.lastActionId;
        }
      }).catch(() => {});
    }
    if (state.user && (_state$room3 = state.room) !== null && _state$room3 !== void 0 && (_state$room3 = _state$room3.media) !== null && _state$room3 !== void 0 && (_state$room3 = _state$room3.movie) !== null && _state$room3 !== void 0 && _state$room3.id && mainVideo.currentTime > 5) {
      var m = state.room.media;
      api('/api/user/progress', {
        method: 'POST',
        body: JSON.stringify({
          movieId: m.movie.id,
          balancerKey: m.balancerKey,
          balancerName: m.balancerName,
          season: m.season,
          episode: m.episode,
          voiceName: m.voiceName,
          currentTime: Math.floor(mainVideo.currentTime),
          duration: Math.floor(mainVideo.duration || 0)
        })
      }).then(r => {
        if (r.progress) state.progress[String(m.movie.id)] = r.progress;
      }).catch(() => {});
    }
  }
  mainVideo.addEventListener('play', () => {
    updateTvOsdUi();
    emitPlayerSync('play');
  });
  mainVideo.addEventListener('pause', () => {
    updateTvOsdUi();
    if (mainVideo.seeking) return;
    emitPlayerSync('pause');
  });
  mainVideo.addEventListener('seeked', () => {
    updateTvOsdUi();
    emitPlayerSync('seek');
  });
  mainVideo.addEventListener('timeupdate', () => {
    updateTvOsdUi();
  });
  mainVideo.addEventListener('loadedmetadata', () => {
    updateTvOsdUi();
  });
  mainVideo.addEventListener('ratechange', () => emitPlayerSync('rate'));
  mainVideo.addEventListener('volumechange', () => {
    if (!mainVideo.muted) $('unmuteSyncBtn').classList.add('hidden');
    updateTvOsdUi();
  });
  setInterval(_asyncToGenerator(_regenerator().m(function _callee1() {
    var isHost, recentlyActed, body, res, _state$room$media, _state$room$media2, _res$room$media, _res$room$media2, prevMediaUrl, nextMediaUrl, pb, hasNewExplicitCmd, _t7;
    return _regenerator().w(function (_context1) {
      while (1) switch (_context1.p = _context1.n) {
        case 0:
          if (state.room) {
            _context1.n = 1;
            break;
          }
          return _context1.a(2);
        case 1:
          if (socket.connected) {
            _context1.n = 6;
            break;
          }
          _context1.p = 2;
          isHost = state.user && state.room.hostId === state.user.id;
          recentlyActed = Date.now() - state.lastSyncAt < 3500;
          body = isHost && state.room.media && state.room.media.streamType !== 'youtube' && !mainVideo.paused && !recentlyActed ? {
            action: 'heartbeat',
            playing: true,
            currentTime: mainVideo.currentTime || 0,
            rate: mainVideo.playbackRate || 1,
            clientId: state.clientId
          } : {
            clientId: state.clientId
          };
          _context1.n = 3;
          return api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
            method: 'POST',
            body: JSON.stringify(body)
          });
        case 3:
          res = _context1.v;
          if (res.room) {
            prevMediaUrl = ((_state$room$media = state.room.media) === null || _state$room$media === void 0 ? void 0 : _state$room$media.streamUrl) || ((_state$room$media2 = state.room.media) === null || _state$room$media2 === void 0 ? void 0 : _state$room$media2.youtubeId) || '';
            nextMediaUrl = ((_res$room$media = res.room.media) === null || _res$room$media === void 0 ? void 0 : _res$room$media.streamUrl) || ((_res$room$media2 = res.room.media) === null || _res$room$media2 === void 0 ? void 0 : _res$room$media2.youtubeId) || '';
            state.room = res.room;
            renderRoomHeader(res.room);
            renderRoomParticipants(res.room.participants || []);
            syncRoomMessagesFromPoll(res.room.messages || []);
            if (nextMediaUrl && nextMediaUrl !== prevMediaUrl) {
              loadMediaIntoPlayer(res.room.media, res.room.playback);
            } else if (res.room.playback) {
              pb = res.room.playback;
              hasNewExplicitCmd = pb.lastActionId && pb.lastActionId !== state.lastAppliedActionId && pb.actorClientId !== state.clientId;
              if (hasNewExplicitCmd) {
                state.lastAppliedActionId = pb.lastActionId;
                applyRemoteSync(_objectSpread(_objectSpread({}, pb), {}, {
                  action: pb.lastAction || 'sync'
                }), false);
              } else if (!isHost) {
                applyRemoteSync(pb, true);
              }
            }
          }
          _context1.n = 5;
          break;
        case 4:
          _context1.p = 4;
          _t7 = _context1.v;
          if (_t7 && _t7.message && (_t7.message.includes('найдена') || _t7.message.includes('закрыта') || _t7.message.includes('404'))) {
            showToast('Комната была закрыта');
            leaveRoom();
            switchView('explore');
          }
        case 5:
          return _context1.a(2);
        case 6:
          if (!(!state.room.media || state.room.media.streamType === 'youtube')) {
            _context1.n = 7;
            break;
          }
          return _context1.a(2);
        case 7:
          if (!(mainVideo.paused || state.suppressSyncEmit)) {
            _context1.n = 8;
            break;
          }
          return _context1.a(2);
        case 8:
          if (!(Date.now() < state.justLoadedMediaUntil && (mainVideo.currentTime || 0) < 2)) {
            _context1.n = 9;
            break;
          }
          return _context1.a(2);
        case 9:
          socket.emit('player:heartbeat', {
            playing: !mainVideo.paused,
            currentTime: mainVideo.currentTime || 0,
            rate: mainVideo.playbackRate || 1,
            watchDelta: 2.5,
            clientId: state.clientId
          });
        case 10:
          return _context1.a(2);
      }
    }, _callee1, null, [[2, 4]]);
  })), 2500);
  function pollActiveDmChat() {
    return _pollActiveDmChat.apply(this, arguments);
  }
  function _pollActiveDmChat() {
    _pollActiveDmChat = _asyncToGenerator(_regenerator().m(function _callee34() {
      var targetFriendId, data, idx, _t28;
      return _regenerator().w(function (_context34) {
        while (1) switch (_context34.p = _context34.n) {
          case 0:
            if (!(!state.user || dmPollInFlight)) {
              _context34.n = 1;
              break;
            }
            return _context34.a(2);
          case 1:
            targetFriendId = state.currentView === 'friends' ? activeDmFriendId : state.currentView === 'room' ? roomActiveDmFriendId : null;
            if (targetFriendId) {
              _context34.n = 2;
              break;
            }
            return _context34.a(2);
          case 2:
            dmPollInFlight = true;
            _context34.p = 3;
            _context34.n = 4;
            return api(`/api/dms/${encodeURIComponent(targetFriendId)}`);
          case 4:
            data = _context34.v;
            if (data.friend) {
              idx = state.friends.findIndex(x => x.id === data.friend.id);
              if (idx >= 0) state.friends[idx] = _objectSpread(_objectSpread({}, state.friends[idx]), data.friend);
              if (activeDmFriendId === data.friend.id) updateDmHeader(data.friend);
            }
            syncDmMessagesFromPoll(targetFriendId, data.messages || []);
            _context34.n = 6;
            break;
          case 5:
            _context34.p = 5;
            _t28 = _context34.v;
          case 6:
            _context34.p = 6;
            dmPollInFlight = false;
            return _context34.f(6);
          case 7:
            return _context34.a(2);
        }
      }, _callee34, null, [[3, 5, 6, 7]]);
    }));
    return _pollActiveDmChat.apply(this, arguments);
  }
  setInterval(pollActiveDmChat, 1200);
  function triggerPlayerResync() {
    return _triggerPlayerResync.apply(this, arguments);
  }
  function _triggerPlayerResync() {
    _triggerPlayerResync = _asyncToGenerator(_regenerator().m(function _callee35() {
      var _res$room2, res, _t29;
      return _regenerator().w(function (_context35) {
        while (1) switch (_context35.p = _context35.n) {
          case 0:
            if (!socket.connected) {
              _context35.n = 1;
              break;
            }
            socket.emit('player:request_sync');
            _context35.n = 5;
            break;
          case 1:
            if (!state.room) {
              _context35.n = 5;
              break;
            }
            _context35.p = 2;
            _context35.n = 3;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}`);
          case 3:
            res = _context35.v;
            if ((_res$room2 = res.room) !== null && _res$room2 !== void 0 && _res$room2.playback) applyRemoteSync(_objectSpread(_objectSpread({}, res.room.playback), {}, {
              action: 'resync'
            }), false);
            _context35.n = 5;
            break;
          case 4:
            _context35.p = 4;
            _t29 = _context35.v;
          case 5:
            showToast('Синхронизировано с комнатой');
          case 6:
            return _context35.a(2);
        }
      }, _callee35, null, [[2, 4]]);
    }));
    return _triggerPlayerResync.apply(this, arguments);
  }
  document.querySelectorAll('.btn-resync-player, #resyncPlayerBtn').forEach(btn => {
    btn.addEventListener('click', triggerPlayerResync);
  });
  function applyRemoteSync(data, isHeartbeat = false) {
    if (!state.room || !state.room.media || state.room.media.streamType === 'youtube') return;
    if (!mainVideo.src && !state.hls) return;
    if (data.lastActionId) {
      state.lastAppliedActionId = data.lastActionId;
    }
    var targetTime = Number(data.currentTime) || 0;
    var curTime = mainVideo.currentTime || 0;
    var timeDiff = targetTime - curTime;
    var absDiff = Math.abs(timeDiff);
    state.suppressSyncEmit = true;
    if (!isHeartbeat && (data.action === 'volume' || data.action === 'mute')) {
      if (typeof data.volume === 'number') {
        var nextMultiplier = Math.max(0, Math.min(2.5, data.volume));
        currentVolumeMultiplier = nextMultiplier;
        localStorage.setItem('oulo_volume_multiplier', String(currentVolumeMultiplier));
        mainVideo.volume = Math.min(1, nextMultiplier);
        if (typeof audioBoostGain !== 'undefined' && audioBoostGain && audioBoostCtx) {
          if (audioBoostCtx.state === 'suspended') audioBoostCtx.resume().catch(() => {});
          audioBoostGain.gain.setTargetAtTime(nextMultiplier, audioBoostCtx.currentTime, 0.05);
        }
      }
      if (typeof data.muted === 'boolean') {
        mainVideo.muted = data.muted;
        $('unmuteSyncBtn').classList.toggle('hidden', !mainVideo.muted);
      }
      var pct = Math.round((currentVolumeMultiplier !== null && currentVolumeMultiplier !== void 0 ? currentVolumeMultiplier : 1) * 100);
      var boostLabel = (currentVolumeMultiplier !== null && currentVolumeMultiplier !== void 0 ? currentVolumeMultiplier : 1) > 1 ? ' (Усиление)' : '';
      showTvCenterFeedback(mainVideo.muted ? '🔇' : (currentVolumeMultiplier !== null && currentVolumeMultiplier !== void 0 ? currentVolumeMultiplier : 1) > 1 ? '📢' : '🔊', mainVideo.muted ? 'Без звука' : `Громкость ${pct}%${boostLabel}`);
      updateTvOsdUi();
      updateProfilePlaybackUI();
    }
    if (isHeartbeat) {
      if (absDiff < 0.8) {
        if (mainVideo.playbackRate !== (data.rate || 1.0)) {
          mainVideo.playbackRate = data.rate || 1.0;
        }
      } else if (absDiff <= 3.5) {
        var baseRate = data.rate || 1.0;
        var adjustedRate = timeDiff > 0 ? baseRate * 1.04 : baseRate * 0.96;
        if (Math.abs(mainVideo.playbackRate - adjustedRate) > 0.01) {
          mainVideo.playbackRate = adjustedRate;
        }
      } else {
        mainVideo.playbackRate = data.rate || 1.0;
        try {
          mainVideo.currentTime = targetTime;
        } catch (_unused16) {}
      }
    } else if (data.action === 'seek' || data.action === 'resync' || absDiff > 4.0) {
      mainVideo.playbackRate = data.rate || 1.0;
      try {
        mainVideo.currentTime = targetTime;
      } catch (_unused17) {}
      if (data.actor) {
        showSyncBadge(`${data.actor.avatar || '🍿'} ${data.actor.displayName} перемотал(а)`);
      }
    }
    if (data.rate && !isHeartbeat && mainVideo.playbackRate !== data.rate) {
      mainVideo.playbackRate = data.rate;
    }
    if (data.playing && mainVideo.paused) {
      mainVideo.play().then(() => {
        $('unmuteSyncBtn').classList.toggle('hidden', !mainVideo.muted);
        updateTvOsdUi();
      }).catch(() => {
        mainVideo.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        mainVideo.play().catch(() => {});
        updateTvOsdUi();
      });
      if (!isHeartbeat && data.actor) {
        showSyncBadge(`${data.actor.avatar || '▶️'} ${data.actor.displayName} нажал(а) Play`);
        showTvCenterFeedback('▶️', 'Воспроизведение');
      }
    } else if (!data.playing && !mainVideo.paused && !isHeartbeat) {
      mainVideo.pause();
      updateTvOsdUi();
      if (data.actor) {
        showSyncBadge(`${data.actor.avatar || '⏸️'} ${data.actor.displayName} поставил(а) на паузу`);
        showTvCenterFeedback('⏸️', 'Пауза');
      }
    }
    updateTvOsdUi();
    setTimeout(() => {
      state.suppressSyncEmit = false;
    }, 450);
  }
  var syncBadgeTimer = null;
  function showSyncBadge(text) {
    var el = $('syncIndicator');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(syncBadgeTimer);
    syncBadgeTimer = setTimeout(() => el.classList.add('hidden'), 2000);
  }
  var tvOsdHideTimer = null;
  var tvFeedbackTimer = null;
  function formatTvTime(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var hrs = Math.floor(s / 3600);
    var mins = Math.floor(s % 3600 / 60);
    var rem = s % 60;
    var mm = mins < 10 ? '0' + mins : String(mins);
    var ss = rem < 10 ? '0' + rem : String(rem);
    return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function showTvCenterFeedback(icon, text) {
    var box = $('tvCenterFeedback');
    var icoEl = $('tvFeedbackIcon');
    var txtEl = $('tvFeedbackText');
    if (!box || !icoEl || !txtEl) return;
    icoEl.textContent = icon || '▶️';
    txtEl.textContent = text || '';
    box.classList.remove('hidden');
    clearTimeout(tvFeedbackTimer);
    tvFeedbackTimer = setTimeout(() => {
      box.classList.add('hidden');
    }, 1150);
  }
  function updateTvOsdUi() {
    var _mainVideo$volume;
    var cur = mainVideo.currentTime || 0;
    var dur = mainVideo.duration && isFinite(mainVideo.duration) ? mainVideo.duration : 0;
    var pct = dur > 0 ? Math.min(100, Math.max(0, cur / dur * 100)) : 0;
    if ($('tvTimeCurrent')) $('tvTimeCurrent').textContent = formatTvTime(cur);
    if ($('tvTimeDuration')) $('tvTimeDuration').textContent = formatTvTime(dur);
    if ($('tvTimelineFill')) $('tvTimelineFill').style.width = `${pct.toFixed(2)}%`;
    if ($('tvTimelineThumb')) $('tvTimelineThumb').style.left = `${pct.toFixed(2)}%`;
    var isPaused = mainVideo.paused;
    if ($('tvPlayPauseIcon')) {
      $('tvPlayPauseIcon').innerHTML = isPaused ? '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    }
    if ($('tvPlayPauseLabel')) $('tvPlayPauseLabel').textContent = isPaused ? 'Плей' : 'Пауза';
    var effectiveVol = typeof currentVolumeMultiplier !== 'undefined' && currentVolumeMultiplier !== null ? currentVolumeMultiplier : (_mainVideo$volume = mainVideo.volume) !== null && _mainVideo$volume !== void 0 ? _mainVideo$volume : 1;
    var volPct = mainVideo.muted ? 'Выкл' : `${Math.round(effectiveVol * 100)}%`;
    if ($('tvMuteIcon')) {
      $('tvMuteIcon').innerHTML = mainVideo.muted || effectiveVol === 0 ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    }
    if ($('tvVolumeLabel')) $('tvVolumeLabel').textContent = volPct;
    if ($('tvRemoteTimeText')) {
      $('tvRemoteTimeText').textContent = `${formatTvTime(cur)} / ${formatTvTime(dur)}`;
    }
    if ($('tvRemoteStateBadge')) {
      $('tvRemoteStateBadge').textContent = isPaused ? '⏸ Пауза' : '▶️ Идёт показ';
    }
    if ($('tvRemotePlayIcon')) {
      $('tvRemotePlayIcon').textContent = isPaused ? '▶️' : '⏸️';
    }
    if ($('tvRemotePlayLbl')) {
      $('tvRemotePlayLbl').textContent = isPaused ? 'Плей' : 'Пауза';
    }
  }
  function wakeTvOsd(focusFirstBtn = false) {
    var osd = $('tvPlayerOsd');
    if (!osd || !state.room || !state.room.media) return;
    updateTvOsdUi();
    osd.classList.remove('hidden');
    clearTimeout(tvOsdHideTimer);
    if (focusFirstBtn) {
      var playBtn = $('tvPlayPauseBtn');
      if (playBtn && !osd.contains(document.activeElement)) {
        playBtn.focus();
      }
    }
    tvOsdHideTimer = setTimeout(() => {
      if (mainVideo.paused) return;
      if (osd.contains(document.activeElement) && state.tvMode) return;
      osd.classList.add('hidden');
    }, 4200);
  }
  function toggleTvPlayPause() {
    if (!state.room || !state.room.media) return;
    wakeTvOsd();
    if (mainVideo.paused) {
      mainVideo.play().then(() => {
        showTvCenterFeedback('▶️', 'Воспроизведение');
        updateTvOsdUi();
      }).catch(() => {
        mainVideo.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        mainVideo.play().catch(() => {});
        showTvCenterFeedback('▶️', 'Воспроизведение');
        updateTvOsdUi();
      });
    } else {
      mainVideo.pause();
      showTvCenterFeedback('⏸️', 'Пауза');
      updateTvOsdUi();
    }
  }
  function seekTvRelative(deltaSec) {
    var _state$room4;
    if (!state.room || !state.room.media) return;
    wakeTvOsd();
    var baseTime = mainVideo.src || state.hls ? mainVideo.currentTime || 0 : ((_state$room4 = state.room) === null || _state$room4 === void 0 || (_state$room4 = _state$room4.playback) === null || _state$room4 === void 0 ? void 0 : _state$room4.currentTime) || 0;
    var dur = mainVideo.duration && isFinite(mainVideo.duration) ? mainVideo.duration : 999999;
    var nextTime = Math.max(0, Math.min(dur, baseTime + deltaSec));
    if (mainVideo.src || state.hls) {
      try {
        mainVideo.currentTime = nextTime;
      } catch (_unused18) {}
    }
    var sign = deltaSec > 0 ? '+' : '';
    showTvCenterFeedback(deltaSec > 0 ? '⏩' : '⏪', `${sign}${deltaSec} сек (${formatTvTime(nextTime)})`);
    updateTvOsdUi();
    emitPlayerSync('seek', {
      currentTime: nextTime,
      playing: !mainVideo.paused
    });
  }
  var audioBoostCtx = null;
  var audioBoostSource = null;
  var audioBoostGain = null;
  var audioBoostCompressor = null;
  var currentVolumeMultiplier = parseFloat(localStorage.getItem('oulo_volume_multiplier') || '1.8');
  function initAudioBooster() {
    if (audioBoostGain) return;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioBoostCtx = new AudioCtx();
      audioBoostSource = audioBoostCtx.createMediaElementSource(mainVideo);
      audioBoostGain = audioBoostCtx.createGain();
      audioBoostCompressor = audioBoostCtx.createDynamicsCompressor();
      audioBoostCompressor.threshold.setValueAtTime(-4, audioBoostCtx.currentTime);
      audioBoostCompressor.knee.setValueAtTime(8, audioBoostCtx.currentTime);
      audioBoostCompressor.ratio.setValueAtTime(14, audioBoostCtx.currentTime);
      audioBoostCompressor.attack.setValueAtTime(0.002, audioBoostCtx.currentTime);
      audioBoostCompressor.release.setValueAtTime(0.2, audioBoostCtx.currentTime);
      audioBoostGain.gain.setValueAtTime(currentVolumeMultiplier, audioBoostCtx.currentTime);
      audioBoostSource.connect(audioBoostGain);
      audioBoostGain.connect(audioBoostCompressor);
      audioBoostCompressor.connect(audioBoostCtx.destination);
    } catch (e) {
      console.warn('AudioBooster init fallback:', e);
    }
  }
  function ensureAudioBoosterActive() {
    if (!audioBoostGain) initAudioBooster();
    if (audioBoostCtx && audioBoostCtx.state === 'suspended') {
      audioBoostCtx.resume().catch(() => {});
    }
  }
  document.addEventListener('click', ensureAudioBoosterActive, {
    passive: true
  });
  document.addEventListener('touchstart', ensureAudioBoosterActive, {
    passive: true
  });
  mainVideo.addEventListener('play', ensureAudioBoosterActive);
  function adjustTvVolume(delta) {
    wakeTvOsd();
    ensureAudioBoosterActive();
    var nextVol = Math.round((currentVolumeMultiplier + delta) * 10) / 10;
    nextVol = Math.max(0, Math.min(2.5, nextVol));
    currentVolumeMultiplier = nextVol;
    localStorage.setItem('oulo_volume_multiplier', String(currentVolumeMultiplier));
    if (nextVol === 0) {
      mainVideo.muted = true;
    } else {
      mainVideo.muted = false;
      mainVideo.volume = Math.min(1, nextVol);
      if (audioBoostGain && audioBoostCtx) {
        if (audioBoostCtx.state === 'suspended') audioBoostCtx.resume().catch(() => {});
        audioBoostGain.gain.setTargetAtTime(nextVol, audioBoostCtx.currentTime, 0.05);
      }
    }
    if (!mainVideo.muted) $('unmuteSyncBtn').classList.add('hidden');
    var pct = Math.round(nextVol * 100);
    var boostLabel = nextVol > 1 ? ' (Усиление)' : '';
    showTvCenterFeedback(nextVol === 0 ? '🔇' : nextVol > 1 ? '📢' : '🔊', nextVol === 0 ? 'Без звука' : `Громкость ${pct}%${boostLabel}`);
    updateTvOsdUi();
    updateProfilePlaybackUI();
    emitPlayerSync('remote', {
      remoteCmd: 'volume',
      volume: nextVol,
      muted: mainVideo.muted
    });
  }
  function toggleTvMute() {
    wakeTvOsd();
    ensureAudioBoosterActive();
    mainVideo.muted = !mainVideo.muted;
    if (!mainVideo.muted && currentVolumeMultiplier === 0) {
      currentVolumeMultiplier = 1.0;
      localStorage.setItem('oulo_volume_multiplier', '1.0');
    }
    if (!mainVideo.muted) {
      mainVideo.volume = Math.min(1, currentVolumeMultiplier);
      if (audioBoostGain && audioBoostCtx) {
        audioBoostGain.gain.setTargetAtTime(currentVolumeMultiplier, audioBoostCtx.currentTime, 0.05);
      }
      $('unmuteSyncBtn').classList.add('hidden');
    }
    var pct = Math.round(currentVolumeMultiplier * 100);
    showTvCenterFeedback(mainVideo.muted ? '🔇' : '🔊', mainVideo.muted ? 'Без звука' : `Звук ${pct}%`);
    updateTvOsdUi();
    updateProfilePlaybackUI();
    emitPlayerSync('remote', {
      remoteCmd: 'mute',
      volume: currentVolumeMultiplier,
      muted: mainVideo.muted
    });
  }
  function switchTvEpisode(deltaIdx) {
    var _state$z2;
    var videos = ((_state$z2 = state.z01) === null || _state$z2 === void 0 ? void 0 : _state$z2.videos) || [];
    if (videos.length <= 1) {
      showTvCenterFeedback('🎬', 'Одна серия / фильм');
      return;
    }
    var nextIdx = (state.z01.activeVideoIdx || 0) + deltaIdx;
    if (nextIdx < 0 || nextIdx >= videos.length) {
      showTvCenterFeedback('🎬', deltaIdx > 0 ? 'Это последняя серия' : 'Это первая серия');
      return;
    }
    var item = videos[nextIdx];
    var epNum = item.episode || nextIdx + 1;
    showTvCenterFeedback(deltaIdx > 0 ? '⏭' : '⏮', `${epNum} серия`);
    selectZ01VideoItem(nextIdx, true);
  }
  function toggleTvFullscreen() {
    var wrapper = $('playerWrapper');
    if (!wrapper) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else if (wrapper.requestFullscreen) {
      wrapper.requestFullscreen().catch(() => {
        if (mainVideo.webkitEnterFullscreen) mainVideo.webkitEnterFullscreen();
      });
    } else if (wrapper.webkitRequestFullscreen) {
      wrapper.webkitRequestFullscreen();
    } else if (mainVideo.webkitEnterFullscreen) {
      mainVideo.webkitEnterFullscreen();
    }
  }
  function toggleTvCinemaMode() {
    state.tvCinemaMode = !state.tvCinemaMode;
    document.body.classList.toggle('tv-cinema-mode', state.tvCinemaMode);
    showTvCenterFeedback('📺', state.tvCinemaMode ? 'Режим ТВ: Широкий экран' : 'Обычный режим');
  }
  function setSmartTvMode(enabled) {
    state.tvMode = !!enabled;
    document.body.classList.toggle('tv-mode', state.tvMode);
    if ($('tvModeToggleBtn')) {
      $('tvModeToggleBtn').textContent = state.tvMode ? '✅ Режим Smart TV включён (крупные кнопки + пульт)' : '🖥️ Режим Smart TV (крупные кнопки для пульта)';
    }
  }
  if (state.tvMode) setSmartTvMode(true);
  (_$39 = $('tvPlayPauseBtn')) === null || _$39 === void 0 || _$39.addEventListener('click', e => {
    e.stopPropagation();
    toggleTvPlayPause();
  });
  (_$40 = $('tvRewindBtn')) === null || _$40 === void 0 || _$40.addEventListener('click', e => {
    e.stopPropagation();
    seekTvRelative(-10);
  });
  (_$41 = $('tvForwardBtn')) === null || _$41 === void 0 || _$41.addEventListener('click', e => {
    e.stopPropagation();
    seekTvRelative(10);
  });
  (_$42 = $('tvPrevEpBtn')) === null || _$42 === void 0 || _$42.addEventListener('click', e => {
    e.stopPropagation();
    switchTvEpisode(-1);
  });
  (_$43 = $('tvNextEpBtn')) === null || _$43 === void 0 || _$43.addEventListener('click', e => {
    e.stopPropagation();
    switchTvEpisode(1);
  });
  (_$44 = $('tvMuteBtn')) === null || _$44 === void 0 || _$44.addEventListener('click', e => {
    e.stopPropagation();
    toggleTvMute();
  });
  (_$45 = $('tvCinemaBtn')) === null || _$45 === void 0 || _$45.addEventListener('click', e => {
    e.stopPropagation();
    toggleTvCinemaMode();
  });
  (_$46 = $('tvFullscreenBtn')) === null || _$46 === void 0 || _$46.addEventListener('click', e => {
    e.stopPropagation();
    toggleTvFullscreen();
  });
  (_$47 = $('tvSourceBtn')) === null || _$47 === void 0 || _$47.addEventListener('click', e => {
    e.stopPropagation();
    setMobileRoomTab('z01');
    var panel = $('z01Panel');
    if (panel) {
      panel.classList.remove('hidden');
      panel.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
      var firstBtn = panel.querySelector('button');
      if (firstBtn) firstBtn.focus();
    }
  });
  (_$48 = $('tvTimelineBar')) === null || _$48 === void 0 || _$48.addEventListener('click', e => {
    e.stopPropagation();
    var bar = $('tvTimelineBar');
    var dur = mainVideo.duration;
    if (!bar || !dur || !isFinite(dur)) return;
    var rect = bar.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var target = ratio * dur;
    try {
      mainVideo.currentTime = target;
    } catch (_unused19) {}
    showTvCenterFeedback('⏩', formatTvTime(target));
    updateTvOsdUi();
    emitPlayerSync('seek', {
      currentTime: target,
      playing: !mainVideo.paused
    });
  });
  (_$49 = $('playerWrapper')) === null || _$49 === void 0 || _$49.addEventListener('mousemove', () => wakeTvOsd(false));
  (_$50 = $('playerWrapper')) === null || _$50 === void 0 || _$50.addEventListener('touchstart', () => wakeTvOsd(false), {
    passive: true
  });
  mainVideo.addEventListener('click', e => {
    if (window.innerWidth > 900) {
      e.preventDefault();
      toggleTvPlayPause();
    }
  });
  mainVideo.addEventListener('dblclick', e => {
    if (window.innerWidth > 900) {
      e.preventDefault();
      toggleTvFullscreen();
    }
  });
  window.addEventListener('resize', () => {
    if (state.loadedStreamKey) {
      mainVideo.controls = window.innerWidth <= 900;
    }
  });
  function toggleSmartTvOsd() {
    var isTv = !document.body.classList.contains('tv-mode');
    setSmartTvMode(isTv);
    if (isTv) {
      wakeTvOsd(true);
      showToast('Управление пультом ТВ активно (стрелки ◀ ▶ и OK)');
    } else {
      var _$51;
      (_$51 = $('tvPlayerOsd')) === null || _$51 === void 0 || _$51.classList.add('hidden');
      showToast('Кнопки ТВ скрыты');
    }
  }
  document.querySelectorAll('.btn-toggle-tv-osd, #toggleTvOsdBtn').forEach(btn => {
    btn.addEventListener('click', toggleSmartTvOsd);
  });
  function openTvRemoteModalDeck() {
    if ($('tvRemoteMovieTitle')) {
      var _state$room5, _state$room6;
      $('tvRemoteMovieTitle').textContent = ((_state$room5 = state.room) === null || _state$room5 === void 0 || (_state$room5 = _state$room5.media) === null || _state$room5 === void 0 ? void 0 : _state$room5.title) || ((_state$room6 = state.room) === null || _state$room6 === void 0 ? void 0 : _state$room6.name) || 'Управление видео на ТВ';
    }
    updateTvOsdUi();
    openModal('tvRemoteModal');
  }
  document.querySelectorAll('.btn-open-tv-remote, #openTvRemoteBtn').forEach(btn => {
    btn.addEventListener('click', openTvRemoteModalDeck);
  });
  (_$52 = $('optionsInviteBtn')) === null || _$52 === void 0 || _$52.addEventListener('click', () => {
    var _$53;
    return (_$53 = $('inviteFriendsModalBtn')) === null || _$53 === void 0 ? void 0 : _$53.click();
  });
  (_$54 = $('optionsCopyLinkBtn')) === null || _$54 === void 0 || _$54.addEventListener('click', () => {
    var _$55;
    return (_$55 = $('copyRoomCodeBtn')) === null || _$55 === void 0 ? void 0 : _$55.click();
  });
  (_$56 = $('optionsLeaveRoomBtn')) === null || _$56 === void 0 || _$56.addEventListener('click', leaveRoom);
  document.querySelectorAll('[data-tv-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      var cmd = btn.dataset.tvCmd;
      if (cmd === 'toggle_play') toggleTvPlayPause();else if (cmd === 'seek_-10') seekTvRelative(-10);else if (cmd === 'seek_+10') seekTvRelative(10);else if (cmd === 'seek_-30') seekTvRelative(-30);else if (cmd === 'seek_+30') seekTvRelative(30);else if (cmd === 'vol_up') adjustTvVolume(0.1);else if (cmd === 'vol_down') adjustTvVolume(-0.1);else if (cmd === 'toggle_mute') toggleTvMute();else if (cmd === 'prev_ep') switchTvEpisode(-1);else if (cmd === 'next_ep') switchTvEpisode(1);else if (cmd === 'toggle_tv_mode') {
        setSmartTvMode(!state.tvMode);
        showToast(state.tvMode ? 'Режим Smart TV включён' : 'Режим Smart TV выключен');
      } else if (cmd === 'open_z01') {
        closeModal('tvRemoteModal');
        setMobileRoomTab('z01');
        var panel = $('z01Panel');
        if (panel) {
          panel.classList.remove('hidden');
          panel.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          });
        }
      }
    });
  });
  function isElemVisible(el) {
    if (!el || el.disabled) return false;
    if (el.closest('.hidden')) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }
  function getFocusableElements() {
    var openModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (openModal) {
      return Array.from(openModal.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(isElemVisible);
    }
    var selector = '.poster-card, .room-card, .cat-pill, .ep-btn, .z01-seg-btn, .z01-opt, .tv-ctrl-btn, .tv-timeline-bar, .nav-item, .bnav-item, button, input:not([type="hidden"])';
    return Array.from(document.querySelectorAll(selector)).filter(el => {
      if (!isElemVisible(el)) return false;
      var viewPage = el.closest('.view-page');
      if (viewPage && !viewPage.classList.contains('active')) return false;
      return true;
    });
  }
  function moveSpatialDpadFocus(dir) {
    setSmartTvMode(true);
    var items = getFocusableElements();
    if (!items.length) return false;
    var cur = document.activeElement;
    if (!cur || cur === document.body || !items.includes(cur)) {
      var firstPoster = items.find(el => el.classList.contains('poster-card') || el.classList.contains('room-card')) || items[0];
      firstPoster.focus();
      firstPoster.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
      return true;
    }
    var curRect = cur.getBoundingClientRect();
    var cx = curRect.left + curRect.width / 2;
    var cy = curRect.top + curRect.height / 2;
    var bestEl = null;
    var bestScore = Infinity;
    var _iterator2 = _createForOfIteratorHelper(items),
      _step2;
    try {
      for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
        var el = _step2.value;
        if (el === cur) continue;
        var r = el.getBoundingClientRect();
        var ex = r.left + r.width / 2;
        var ey = r.top + r.height / 2;
        var dx = ex - cx;
        var dy = ey - cy;
        if (dir === 'left' && dx >= -6) continue;
        if (dir === 'right' && dx <= 6) continue;
        if (dir === 'up' && dy >= -6) continue;
        if (dir === 'down' && dy <= 6) continue;
        var primaryDist = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
        var crossDist = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
        var score = primaryDist + crossDist * 2.6;
        if (score < bestScore) {
          bestScore = score;
          bestEl = el;
        }
      }
    } catch (err) {
      _iterator2.e(err);
    } finally {
      _iterator2.f();
    }
    if (bestEl) {
      bestEl.focus();
      bestEl.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
      return true;
    }
    return false;
  }
  window.addEventListener('keydown', e => {
    var _e$target, _state$room7, _state$room8;
    var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
    var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ((_e$target = e.target) === null || _e$target === void 0 ? void 0 : _e$target.isContentEditable);
    if (isInput) {
      if (e.key === 'Escape' || e.keyCode === 10009 || e.keyCode === 461) {
        e.target.blur();
      }
      return;
    }
    var key = e.key || '';
    var kc = e.keyCode || e.which || 0;
    if (key === 'MediaPlayPause' || kc === 179) {
      e.preventDefault();
      toggleTvPlayPause();
      return;
    }
    if (key === 'MediaPlay' || kc === 415) {
      e.preventDefault();
      if (mainVideo.paused) toggleTvPlayPause();
      return;
    }
    if (key === 'MediaPause' || key === 'MediaStop' || kc === 19 || kc === 413) {
      e.preventDefault();
      if (!mainVideo.paused) toggleTvPlayPause();
      return;
    }
    if (key === 'MediaRewind' || kc === 412) {
      e.preventDefault();
      seekTvRelative(-10);
      return;
    }
    if (key === 'MediaFastForward' || kc === 417) {
      e.preventDefault();
      seekTvRelative(10);
      return;
    }
    if (key === 'MediaTrackNext' || kc === 176 || kc === 425) {
      e.preventDefault();
      switchTvEpisode(1);
      return;
    }
    if (key === 'MediaTrackPrevious' || kc === 177 || kc === 424) {
      e.preventDefault();
      switchTvEpisode(-1);
      return;
    }
    if (key === 'Escape' || key === 'GoBack' || key === 'Backspace' || key === 'BrowserBack' || kc === 10009 || kc === 461 || kc === 8 || kc === 27) {
      var openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
      if (openModals.length > 0) {
        e.preventDefault();
        openModals.forEach(m => m.classList.add('hidden'));
        return;
      }
      if (state.tvCinemaMode) {
        e.preventDefault();
        toggleTvCinemaMode();
        return;
      }
      if (state.currentView === 'room') {
        e.preventDefault();
        leaveRoom();
        return;
      }
      if (state.currentView !== 'explore') {
        e.preventDefault();
        switchView('explore');
        return;
      }
    }
    var anyModalOpen = document.querySelectorAll('.modal-backdrop:not(.hidden)').length > 0;
    var dirMap = {
      ArrowLeft: 'left',
      37: 'left',
      ArrowRight: 'right',
      39: 'right',
      ArrowUp: 'up',
      38: 'up',
      ArrowDown: 'down',
      40: 'down'
    };
    var dpadDir = dirMap[key] || dirMap[kc] || null;
    var hasLoadedStream = !!((_state$room7 = state.room) !== null && _state$room7 !== void 0 && (_state$room7 = _state$room7.media) !== null && _state$room7 !== void 0 && _state$room7.streamUrl || (_state$room8 = state.room) !== null && _state$room8 !== void 0 && (_state$room8 = _state$room8.media) !== null && _state$room8 !== void 0 && _state$room8.youtubeId);
    var inZ01OrOverlay = document.activeElement && (document.activeElement.closest('#z01Panel') || document.activeElement.closest('#playerEmptyOverlay') || document.activeElement.closest('.room-topbar'));
    if (anyModalOpen || state.currentView !== 'room' || !hasLoadedStream || inZ01OrOverlay) {
      if (dpadDir) {
        e.preventDefault();
        moveSpatialDpadFocus(dpadDir);
        return;
      }
      if (isTvSelectKey(e)) {
        var active = document.activeElement;
        if (!active || active === document.body) {
          active = document.querySelector('.modal-backdrop:not(.hidden) button, #catalogGrid .poster-card, #heroWatchPartyBtn');
        }
        if (active && active !== document.body) {
          e.preventDefault();
          active.click();
          return;
        }
      }
      return;
    }
    if (state.currentView === 'room' && state.room && !anyModalOpen) {
      var osd = $('tvPlayerOsd');
      var controlsRow = $('tvControlsRow');
      var activeInControls = controlsRow && controlsRow.contains(document.activeElement);
      var isTimelineFocused = document.activeElement === $('tvTimelineBar');
      if (key === ' ' || key === 'Spacebar' || key.toLowerCase() === 'k') {
        if (!activeInControls) {
          e.preventDefault();
          toggleTvPlayPause();
          return;
        }
      }
      if (isTvSelectKey(e)) {
        var focusedTag = document.activeElement ? document.activeElement.tagName.toUpperCase() : '';
        if (!focusedTag || focusedTag === 'BODY' || focusedTag === 'VIDEO' || document.activeElement === $('playerWrapper') || isTimelineFocused) {
          e.preventDefault();
          toggleTvPlayPause();
          return;
        }
      }
      if (dpadDir === 'left') {
        if (activeInControls && !isTimelineFocused) {
          e.preventDefault();
          var btns = Array.from(controlsRow.querySelectorAll('.tv-ctrl-btn'));
          var idx = btns.indexOf(document.activeElement);
          if (idx > 0) btns[idx - 1].focus();
          wakeTvOsd();
          return;
        }
        e.preventDefault();
        seekTvRelative(-10);
        return;
      }
      if (dpadDir === 'right') {
        if (activeInControls && !isTimelineFocused) {
          e.preventDefault();
          var _btns = Array.from(controlsRow.querySelectorAll('.tv-ctrl-btn'));
          var _idx = _btns.indexOf(document.activeElement);
          if (_idx >= 0 && _idx < _btns.length - 1) _btns[_idx + 1].focus();
          wakeTvOsd();
          return;
        }
        e.preventDefault();
        seekTvRelative(10);
        return;
      }
      if (dpadDir === 'down') {
        if (osd && osd.classList.contains('hidden')) {
          e.preventDefault();
          wakeTvOsd(true);
          return;
        }
        if (isTimelineFocused) {
          var _$57;
          e.preventDefault();
          (_$57 = $('tvPlayPauseBtn')) === null || _$57 === void 0 || _$57.focus();
          wakeTvOsd();
          return;
        }
        if (activeInControls) {
          var z01First = document.querySelector('#z01Panel:not(.hidden) button');
          if (z01First) {
            e.preventDefault();
            z01First.focus();
            z01First.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest'
            });
            return;
          }
        }
        e.preventDefault();
        adjustTvVolume(-0.1);
        return;
      }
      if (dpadDir === 'up') {
        if (activeInControls) {
          var _$58;
          e.preventDefault();
          (_$58 = $('tvTimelineBar')) === null || _$58 === void 0 || _$58.focus();
          wakeTvOsd();
          return;
        }
        if (isTimelineFocused) {
          var _$59;
          e.preventDefault();
          (_$59 = $('leaveRoomBtn')) === null || _$59 === void 0 || _$59.focus();
          return;
        }
        e.preventDefault();
        adjustTvVolume(0.1);
        return;
      }
      if (key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleTvFullscreen();
        return;
      }
      if (key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleTvMute();
        return;
      }
      if (key.toLowerCase() === 'n') {
        e.preventDefault();
        switchTvEpisode(1);
        return;
      }
      if (key.toLowerCase() === 'p') {
        e.preventDefault();
        switchTvEpisode(-1);
        return;
      }
    }
  });
  socket.on('rooms:public_list', list => {
    renderPublicRooms(list || []);
  });
  function forceEvictToHomeScreen(reason = 'Комната закрыта администратором') {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (_unused20) {}
    try {
      stopVoiceChat();
    } catch (_unused21) {}
    try {
      destroyPlayers();
    } catch (_unused22) {}
    try {
      sessionStorage.removeItem('active_room_code');
    } catch (_unused23) {}
    try {
      localStorage.removeItem('active_room_code');
    } catch (_unused24) {}
    state.room = null;
    try {
      sessionStorage.setItem('eviction_notice', reason);
    } catch (_unused25) {}
    window.location.replace('/');
  }
  function handleRoomClosedEviction(data) {
    var _state$room9, _URLSearchParams$get;
    var targetCode = data !== null && data !== void 0 && data.code ? String(data.code).replace(/^#/, '').trim().toUpperCase() : null;
    var currentCode = (_state$room9 = state.room) !== null && _state$room9 !== void 0 && _state$room9.code ? String(state.room.code).replace(/^#/, '').trim().toUpperCase() : null;
    var urlCode = (_URLSearchParams$get = new URLSearchParams(window.location.search).get('room')) === null || _URLSearchParams$get === void 0 ? void 0 : _URLSearchParams$get.replace(/^#/, '').trim().toUpperCase();
    var storedCode = '';
    try {
      storedCode = (sessionStorage.getItem('active_room_code') || '').replace(/^#/, '').trim().toUpperCase();
    } catch (_unused26) {}
    if (targetCode) {
      var match = currentCode && currentCode === targetCode || urlCode && urlCode === targetCode || storedCode && storedCode === targetCode;
      if (!match && state.currentView !== 'room') {
        return;
      }
    }
    forceEvictToHomeScreen((data === null || data === void 0 ? void 0 : data.reason) || (data === null || data === void 0 ? void 0 : data.message) || 'Комната закрыта администратором');
  }
  socket.on('room:closed', handleRoomClosedEviction);
  socket.on('room:kicked', handleRoomClosedEviction);
  socket.on('room:evicted', handleRoomClosedEviction);
  socket.on('room:error', ({
    error
  }) => {
    try {
      sessionStorage.removeItem('active_room_code');
    } catch (_unused27) {}
    try {
      localStorage.removeItem('active_room_code');
    } catch (_unused28) {}
    if (state.currentView === 'room' || window.location.search.includes('room=')) {
      forceEvictToHomeScreen(error || 'Комната недоступна');
    } else {
      showToast(error || 'Ошибка комнаты');
    }
  });
  function handleRoomJoined(_x17) {
    return _handleRoomJoined.apply(this, arguments);
  }
  function _handleRoomJoined() {
    _handleRoomJoined = _asyncToGenerator(_regenerator().m(function _callee36(room) {
      var isRejoin, url, streamKey, isAlreadyPlayingSameMedia;
      return _regenerator().w(function (_context36) {
        while (1) switch (_context36.n) {
          case 0:
            isRejoin = state.room && state.room.code === room.code;
            state.room = room;
            try {
              sessionStorage.setItem('active_room_code', room.code);
            } catch (_unused48) {}
            switchView('room');
            setMobileRoomTab('chat');
            url = new URL(window.location.href);
            url.searchParams.set('room', room.code);
            window.history.replaceState({}, '', url.toString());
            renderRoomHeader(room);
            renderRoomParticipants(room.participants || []);
            renderRoomMessages(room.messages || []);
            renderRoomQueue(room.queue || []);
            if (!room.media) {
              _context36.n = 5;
              break;
            }
            streamKey = room.media.streamUrl || room.media.youtubeId || '';
            isAlreadyPlayingSameMedia = isRejoin && state.loadedStreamKey && state.loadedStreamKey === streamKey;
            if (!(room.media.type === 'z01' && room.media.movie)) {
              _context36.n = 3;
              break;
            }
            if (!room.media.streamUrl) {
              _context36.n = 1;
              break;
            }
            if (isAlreadyPlayingSameMedia) {
              applyRemoteSync(room.playback, false);
            } else {
              loadMediaIntoPlayer(room.media, room.playback);
            }
            loadZ01ForMovieInRoom(room.media.movie, false);
            _context36.n = 2;
            break;
          case 1:
            _context36.n = 2;
            return loadZ01ForMovieInRoom(room.media.movie, true);
          case 2:
            _context36.n = 4;
            break;
          case 3:
            $('z01Panel').classList.add('hidden');
            if (isAlreadyPlayingSameMedia) {
              applyRemoteSync(room.playback, false);
            } else {
              loadMediaIntoPlayer(room.media, room.playback);
            }
          case 4:
            _context36.n = 6;
            break;
          case 5:
            $('z01Panel').classList.add('hidden');
            setPlayerOverlay(true, false, 'Выберите фильм из каталога или вставьте ссылку');
          case 6:
            return _context36.a(2);
        }
      }, _callee36);
    }));
    return _handleRoomJoined.apply(this, arguments);
  }
  socket.on('room:joined', handleRoomJoined);
  socket.on('room:state', room => {
    state.room = room;
    renderRoomHeader(room);
    renderRoomParticipants(room.participants || []);
    renderRoomQueue(room.queue || []);
  });
  socket.on('room:queue_updated', queue => {
    if (state.room) state.room.queue = queue || [];
    renderRoomQueue(queue || []);
  });
  socket.on('room:participants', list => {
    if (state.room) state.room.participants = list;
    renderRoomParticipants(list || []);
  });
  socket.on('room:media_changed', ({
    media,
    playback
  }) => {
    if (!state.room) return;
    state.room.media = media;
    state.room.playback = playback;
    renderRoomHeader(state.room);
    loadMediaIntoPlayer(media, playback);
    if (media && media.type === 'z01' && media.movie && (!state.z01.movie || String(state.z01.movie.id) !== String(media.movie.id))) {
      loadZ01ForMovieInRoom(media.movie, false);
    }
  });
  socket.on('player:sync', data => {
    applyRemoteSync(data, false);
  });
  socket.on('player:heartbeat', data => {
    applyRemoteSync(data, true);
  });
  socket.on('chat:message', msg => {
    appendChatMessage(msg, true);
  });
  socket.on('chat:updated', msg => {
    updateChatMessageDom(msg, 'room');
  });
  socket.on('chat:deleted', ({
    id
  }) => {
    removeChatMessageDom(id);
  });
  socket.on('room:reaction', ({
    emoji
  }) => {
    spawnFloatingEmoji(emoji);
  });
  socket.on('room:invite_received', ({
    from,
    room
  }) => {
    triggerAppNotification({
      title: `${from.displayName} зовёт в комнату! 🍿`,
      body: `Смотреть вместе: «${room.mediaTitle}»`,
      user: from,
      kind: 'invite',
      data: {
        roomCode: room.code,
        tag: 'invite-' + room.code
      },
      onClick: () => joinRoomByCode(room.code)
    });
  });
  socket.on('friends:update', () => {
    if (state.user) loadFriends();
  });
  socket.on('toast', ({
    text
  }) => {
    if (!text) return;
    var lower = text.toLowerCase();
    if (lower.includes('закрыта администратором') || lower.includes('закрыты администратором') || lower.includes('выселен')) {
      forceEvictToHomeScreen(text);
      return;
    }
    showToast(text);
  });
  var composers = {
    room: {
      replyTo: null,
      editingMsg: null,
      imageUrl: '',
      viewOnce: false,
      barId: 'chatComposerBar',
      inputId: 'chatInput'
    },
    dm: {
      replyTo: null,
      editingMsg: null,
      imageUrl: '',
      viewOnce: false,
      barId: 'dmComposerBar',
      inputId: 'dmInput'
    },
    roomDm: {
      replyTo: null,
      editingMsg: null,
      imageUrl: '',
      viewOnce: false,
      barId: 'roomDmComposerBar',
      inputId: 'roomDmInput'
    }
  };
  var activePhotoTarget = 'room';
  var activeTgMenuCtx = null;
  var viewOnceTimerId = null;
  function resizeChatImageFile(file) {
    return new Promise((resolve, reject) => {
      var reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать фото'));
      reader.onload = () => {
        var img = new Image();
        img.onerror = () => reject(new Error('Некорректный формат изображения'));
        img.onload = () => {
          var maxDim = 1080;
          var width = img.width,
            height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round(height * maxDim / width);
              width = maxDim;
            } else {
              width = Math.round(width * maxDim / height);
              height = maxDim;
            }
          }
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function renderComposerBar(target) {
    var c = composers[target];
    if (!c) return;
    var bar = $(c.barId);
    if (!bar) return;
    if (!c.replyTo && !c.editingMsg && !c.imageUrl) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    var html = '';
    if (c.editingMsg) {
      html += `
        <div class="composer-item">
          <div class="composer-item-left">
            <span>✏️</span>
            <div class="composer-text"><strong>Редактирование</strong>: ${esc(c.editingMsg.text || '')}</div>
          </div>
          <button type="button" class="composer-cancel-btn" data-clear-edit="${esc(target)}">✕</button>
        </div>
      `;
    } else if (c.replyTo) {
      html += `
        <div class="composer-item">
          <div class="composer-item-left">
            <span>↩️</span>
            <div class="composer-text"><strong>${esc(c.replyTo.senderName)}</strong>: ${esc(c.replyTo.text || '📷 Фотография')}</div>
          </div>
          <button type="button" class="composer-cancel-btn" data-clear-reply="${esc(target)}">✕</button>
        </div>
      `;
    }
    if (c.imageUrl) {
      html += `
        <div class="composer-item">
          <div class="composer-item-left">
            <img class="composer-thumb" src="${esc(c.imageUrl)}" alt="" />
            <div class="composer-text">${c.viewOnce ? '🔥 <strong>Одноразовое фото</strong> (исчезнет после просмотра)' : '📷 <strong>Фотография</strong>'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="composer-viewonce-btn ${c.viewOnce ? 'active' : ''}" data-toggle-viewonce="${esc(target)}" title="Одноразовое фото (как в Telegram)">
              ${c.viewOnce ? '🔥 1 просмотр' : '1️⃣ 1 раз'}
            </button>
            <button type="button" class="composer-cancel-btn" data-clear-photo="${esc(target)}">✕</button>
          </div>
        </div>
      `;
    }
    bar.innerHTML = html;
    bar.querySelectorAll('[data-clear-reply]').forEach(btn => {
      btn.onclick = () => {
        c.replyTo = null;
        renderComposerBar(target);
      };
    });
    bar.querySelectorAll('[data-clear-edit]').forEach(btn => {
      btn.onclick = () => {
        c.editingMsg = null;
        clearChatInput(c.inputId);
        renderComposerBar(target);
      };
    });
    bar.querySelectorAll('[data-clear-photo]').forEach(btn => {
      btn.onclick = () => {
        c.imageUrl = '';
        c.viewOnce = false;
        renderComposerBar(target);
      };
    });
    bar.querySelectorAll('[data-toggle-viewonce]').forEach(btn => {
      btn.onclick = () => {
        c.viewOnce = !c.viewOnce;
        renderComposerBar(target);
      };
    });
  }
  function setComposerReply(target, msg) {
    var _msg$user, _msg$sender;
    var c = composers[target];
    if (!c) return;
    c.editingMsg = null;
    var senderName = ((_msg$user = msg.user) === null || _msg$user === void 0 ? void 0 : _msg$user.displayName) || ((_msg$sender = msg.sender) === null || _msg$sender === void 0 ? void 0 : _msg$sender.displayName) || 'Собеседник';
    c.replyTo = {
      id: msg.id,
      senderName,
      text: msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : msg.hasPhoto || msg.hasImage || msg.imageUrl ? '📷 Фотография' : ''),
      hasPhoto: !!(msg.hasPhoto || msg.hasImage || msg.imageUrl)
    };
    renderComposerBar(target);
    focusChatInput(c.inputId);
  }
  function setComposerEdit(target, msg, friendId = null) {
    var c = composers[target];
    if (!c) return;
    c.replyTo = null;
    c.editingMsg = {
      id: msg.id,
      text: msg.text || '',
      friendId
    };
    renderComposerBar(target);
    setChatInputValue(c.inputId, msg.text || '');
    focusChatInput(c.inputId);
  }
  document.querySelectorAll('.attach-photo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activePhotoTarget = btn.dataset.chatTarget || 'room';
      $('chatPhotoInput').value = '';
      $('chatPhotoInput').click();
    });
  });
  (_$60 = $('chatPhotoInput')) === null || _$60 === void 0 || _$60.addEventListener('change', function () {
    var _ref12 = _asyncToGenerator(_regenerator().m(function _callee10(e) {
      var _e$target$files2;
      var file, dataUrl, c, _$61, _t8;
      return _regenerator().w(function (_context10) {
        while (1) switch (_context10.p = _context10.n) {
          case 0:
            file = (_e$target$files2 = e.target.files) === null || _e$target$files2 === void 0 ? void 0 : _e$target$files2[0];
            if (file) {
              _context10.n = 1;
              break;
            }
            return _context10.a(2);
          case 1:
            _context10.p = 1;
            _context10.n = 2;
            return resizeChatImageFile(file);
          case 2:
            dataUrl = _context10.v;
            c = composers[activePhotoTarget];
            if (c) {
              c.imageUrl = dataUrl;
              renderComposerBar(activePhotoTarget);
              (_$61 = $(c.inputId)) === null || _$61 === void 0 || _$61.focus();
            }
            _context10.n = 4;
            break;
          case 3:
            _context10.p = 3;
            _t8 = _context10.v;
            showToast(_t8.message);
          case 4:
            return _context10.a(2);
        }
      }, _callee10, null, [[1, 3]]);
    }));
    return function (_x18) {
      return _ref12.apply(this, arguments);
    };
  }());
  function openPhotoLightbox(imageUrl, caption = '', isViewOnce = false) {
    if (!imageUrl) return;
    clearTimeout(viewOnceTimerId);
    $('photoViewerImg').src = imageUrl;
    $('photoViewerCaption').textContent = caption || '';
    $('photoViewerBadge').classList.toggle('hidden', !isViewOnce);
    var timerWrap = $('photoViewerTimerWrap');
    var timerBar = $('photoViewerTimerBar');
    if (isViewOnce && timerWrap && timerBar) {
      timerWrap.classList.remove('hidden');
      timerBar.style.transition = 'none';
      timerBar.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          timerBar.style.transition = 'transform 10s linear';
          timerBar.style.transform = 'scaleX(0)';
        });
      });
      viewOnceTimerId = setTimeout(() => {
        $('photoViewerModal').classList.add('hidden');
        $('photoViewerImg').src = '';
      }, 10000);
    } else if (timerWrap) {
      timerWrap.classList.add('hidden');
    }
    $('photoViewerModal').classList.remove('hidden');
  }
  function handleViewOnceClick(_x19, _x20) {
    return _handleViewOnceClick.apply(this, arguments);
  }
  function _handleViewOnceClick() {
    _handleViewOnceClick = _asyncToGenerator(_regenerator().m(function _callee37(msg, contextType, friendId = null) {
      var _msg$user7;
      var uid, isSender, res, targetFriend, _res, _t30;
      return _regenerator().w(function (_context37) {
        while (1) switch (_context37.p = _context37.n) {
          case 0:
            uid = msg.fromId || ((_msg$user7 = msg.user) === null || _msg$user7 === void 0 ? void 0 : _msg$user7.id) || '';
            isSender = state.user && uid === state.user.id;
            if (!msg.viewed) {
              _context37.n = 1;
              break;
            }
            showToast('💨 Фотография уже была просмотрена и удалена');
            return _context37.a(2);
          case 1:
            if (!(isSender && contextType === 'dm')) {
              _context37.n = 2;
              break;
            }
            showToast('Вы отправили одноразовое фото — его может открыть только получатель');
            return _context37.a(2);
          case 2:
            _context37.p = 2;
            if (!(contextType === 'room')) {
              _context37.n = 5;
              break;
            }
            if (state.room) {
              _context37.n = 3;
              break;
            }
            return _context37.a(2);
          case 3:
            _context37.n = 4;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/view-once`, {
              method: 'POST',
              body: JSON.stringify({
                messageId: msg.id
              })
            });
          case 4:
            res = _context37.v;
            if (res.imageUrl) {
              openPhotoLightbox(res.imageUrl, msg.text || '', true);
            }
            if (res.message) updateChatMessageDom(res.message, 'room');
            _context37.n = 8;
            break;
          case 5:
            targetFriend = friendId || activeDmFriendId || roomActiveDmFriendId;
            if (targetFriend) {
              _context37.n = 6;
              break;
            }
            return _context37.a(2);
          case 6:
            _context37.n = 7;
            return api(`/api/dms/${encodeURIComponent(targetFriend)}/view-once`, {
              method: 'POST',
              body: JSON.stringify({
                messageId: msg.id
              })
            });
          case 7:
            _res = _context37.v;
            if (_res.imageUrl) {
              openPhotoLightbox(_res.imageUrl, msg.text || '', true);
            }
            if (_res.message) updateChatMessageDom(_res.message, 'dm');
          case 8:
            _context37.n = 10;
            break;
          case 9:
            _context37.p = 9;
            _t30 = _context37.v;
            showToast(_t30.message);
          case 10:
            return _context37.a(2);
        }
      }, _callee37, null, [[2, 9]]);
    }));
    return _handleViewOnceClick.apply(this, arguments);
  }
  function handleToggleMessageReaction(_x21, _x22, _x23) {
    return _handleToggleMessageReaction.apply(this, arguments);
  }
  function _handleToggleMessageReaction() {
    _handleToggleMessageReaction = _asyncToGenerator(_regenerator().m(function _callee38(msg, emoji, contextType, friendId = null) {
      var res, _state$user7, targetFriend, _res2, _t31, _t32;
      return _regenerator().w(function (_context38) {
        while (1) switch (_context38.p = _context38.n) {
          case 0:
            if (!(contextType === 'room')) {
              _context38.n = 6;
              break;
            }
            if (state.room) {
              _context38.n = 1;
              break;
            }
            return _context38.a(2);
          case 1:
            if (!socket.connected) {
              _context38.n = 2;
              break;
            }
            socket.emit('chat:react', {
              messageId: msg.id,
              emoji
            });
            _context38.n = 5;
            break;
          case 2:
            _context38.p = 2;
            _context38.n = 3;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/react`, {
              method: 'POST',
              body: JSON.stringify({
                messageId: msg.id,
                emoji
              })
            });
          case 3:
            res = _context38.v;
            if (res.message) updateChatMessageDom(res.message, 'room');
            _context38.n = 5;
            break;
          case 4:
            _context38.p = 4;
            _t31 = _context38.v;
          case 5:
            _context38.n = 11;
            break;
          case 6:
            targetFriend = friendId || (msg.fromId === ((_state$user7 = state.user) === null || _state$user7 === void 0 ? void 0 : _state$user7.id) ? msg.toId : msg.fromId) || activeDmFriendId || roomActiveDmFriendId;
            if (targetFriend) {
              _context38.n = 7;
              break;
            }
            return _context38.a(2);
          case 7:
            if (!socket.connected) {
              _context38.n = 8;
              break;
            }
            socket.emit('dm:react', {
              friendId: targetFriend,
              messageId: msg.id,
              emoji
            });
            _context38.n = 11;
            break;
          case 8:
            _context38.p = 8;
            _context38.n = 9;
            return api(`/api/dms/${encodeURIComponent(targetFriend)}/react`, {
              method: 'POST',
              body: JSON.stringify({
                messageId: msg.id,
                emoji
              })
            });
          case 9:
            _res2 = _context38.v;
            if (_res2.message) updateChatMessageDom(_res2.message, 'dm');
            _context38.n = 11;
            break;
          case 10:
            _context38.p = 10;
            _t32 = _context38.v;
          case 11:
            return _context38.a(2);
        }
      }, _callee38, null, [[8, 10], [2, 4]]);
    }));
    return _handleToggleMessageReaction.apply(this, arguments);
  }
  function handleDeleteMessage(_x24, _x25) {
    return _handleDeleteMessage.apply(this, arguments);
  }
  function _handleDeleteMessage() {
    _handleDeleteMessage = _asyncToGenerator(_regenerator().m(function _callee39(msg, contextType, friendId = null) {
      var _state$user8, targetFriend, _t33, _t34;
      return _regenerator().w(function (_context39) {
        while (1) switch (_context39.p = _context39.n) {
          case 0:
            if (!(contextType === 'room')) {
              _context39.n = 6;
              break;
            }
            if (state.room) {
              _context39.n = 1;
              break;
            }
            return _context39.a(2);
          case 1:
            if (!socket.connected) {
              _context39.n = 2;
              break;
            }
            socket.emit('chat:delete', {
              messageId: msg.id
            });
            _context39.n = 5;
            break;
          case 2:
            _context39.p = 2;
            _context39.n = 3;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/${encodeURIComponent(msg.id)}`, {
              method: 'DELETE'
            });
          case 3:
            removeChatMessageDom(msg.id);
            _context39.n = 5;
            break;
          case 4:
            _context39.p = 4;
            _t33 = _context39.v;
            showToast(_t33.message);
          case 5:
            _context39.n = 11;
            break;
          case 6:
            targetFriend = friendId || (msg.fromId === ((_state$user8 = state.user) === null || _state$user8 === void 0 ? void 0 : _state$user8.id) ? msg.toId : msg.fromId) || activeDmFriendId || roomActiveDmFriendId;
            if (targetFriend) {
              _context39.n = 7;
              break;
            }
            return _context39.a(2);
          case 7:
            if (!socket.connected) {
              _context39.n = 8;
              break;
            }
            socket.emit('dm:delete', {
              friendId: targetFriend,
              messageId: msg.id
            });
            _context39.n = 11;
            break;
          case 8:
            _context39.p = 8;
            _context39.n = 9;
            return api(`/api/dms/${encodeURIComponent(targetFriend)}/${encodeURIComponent(msg.id)}`, {
              method: 'DELETE'
            });
          case 9:
            removeChatMessageDom(msg.id);
            _context39.n = 11;
            break;
          case 10:
            _context39.p = 10;
            _t34 = _context39.v;
            showToast(_t34.message);
          case 11:
            return _context39.a(2);
        }
      }, _callee39, null, [[8, 10], [2, 4]]);
    }));
    return _handleDeleteMessage.apply(this, arguments);
  }
  function openTelegramMsgMenu(clientX, clientY, ctx) {
    var _msg$user2, _state$user4, _el$querySelector;
    closeTelegramMsgMenu();
    activeTgMenuCtx = ctx;
    var msg = ctx.msg,
      el = ctx.el;
    el.classList.add('context-active');
    var uid = msg.fromId || ((_msg$user2 = msg.user) === null || _msg$user2 === void 0 ? void 0 : _msg$user2.id) || '';
    var isOwn = state.user && uid === state.user.id;
    var canDelete = isOwn || ctx.contextType === 'room' && state.room && state.room.hostId === ((_state$user4 = state.user) === null || _state$user4 === void 0 ? void 0 : _state$user4.id);
    $('tgMenuCopyBtn').classList.toggle('hidden', !msg.text);
    $('tgMenuEditBtn').classList.toggle('hidden', !isOwn || !msg.text);
    $('tgMenuDeleteBtn').classList.toggle('hidden', !canDelete);
    var myReactions = new Set();
    if (msg.reactions && state.user) {
      for (var _i = 0, _Object$entries = Object.entries(msg.reactions); _i < _Object$entries.length; _i++) {
        var _Object$entries$_i = _slicedToArray(_Object$entries[_i], 2),
          em = _Object$entries$_i[0],
          arr = _Object$entries$_i[1];
        if (Array.isArray(arr) && arr.includes(state.user.id)) myReactions.add(em);
      }
    }
    document.querySelectorAll('#tgReactionStrip .tg-rx-btn').forEach(btn => {
      btn.classList.toggle('active', myReactions.has(btn.dataset.tgRx));
    });
    var overlay = $('tgMsgOverlay');
    var popup = $('tgMsgPopup');
    overlay.classList.remove('hidden');
    var popW = 248;
    var popH = isOwn ? 225 : 150;
    var rect = ((_el$querySelector = el.querySelector('.chat-bubble')) === null || _el$querySelector === void 0 ? void 0 : _el$querySelector.getBoundingClientRect()) || {
      left: clientX,
      top: clientY,
      right: clientX
    };
    var left = isOwn ? rect.right - popW : rect.left;
    var top = (clientY || rect.top) - 52;
    left = Math.max(10, Math.min(window.innerWidth - popW - 10, left));
    top = Math.max(12, Math.min(window.innerHeight - popH - 12, top));
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }
  function closeTelegramMsgMenu() {
    var _activeTgMenuCtx, _$62;
    if ((_activeTgMenuCtx = activeTgMenuCtx) !== null && _activeTgMenuCtx !== void 0 && _activeTgMenuCtx.el) {
      activeTgMenuCtx.el.classList.remove('context-active');
    }
    activeTgMenuCtx = null;
    (_$62 = $('tgMsgOverlay')) === null || _$62 === void 0 || _$62.classList.add('hidden');
  }
  (_$63 = $('tgMsgOverlay')) === null || _$63 === void 0 || _$63.addEventListener('click', e => {
    if (e.target === $('tgMsgOverlay')) closeTelegramMsgMenu();
  });
  document.querySelectorAll('#tgReactionStrip .tg-rx-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeTgMenuCtx) return;
      var _activeTgMenuCtx2 = activeTgMenuCtx,
        msg = _activeTgMenuCtx2.msg,
        contextType = _activeTgMenuCtx2.contextType,
        friendId = _activeTgMenuCtx2.friendId;
      closeTelegramMsgMenu();
      handleToggleMessageReaction(msg, btn.dataset.tgRx, contextType, friendId);
    });
  });
  (_$64 = $('tgMenuReplyBtn')) === null || _$64 === void 0 || _$64.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    var _activeTgMenuCtx3 = activeTgMenuCtx,
      msg = _activeTgMenuCtx3.msg,
      composerTarget = _activeTgMenuCtx3.composerTarget;
    closeTelegramMsgMenu();
    setComposerReply(composerTarget, msg);
  });
  (_$65 = $('tgMenuCopyBtn')) === null || _$65 === void 0 || _$65.addEventListener('click', () => {
    var _activeTgMenuCtx$msg;
    if (!activeTgMenuCtx) return;
    var txt = ((_activeTgMenuCtx$msg = activeTgMenuCtx.msg) === null || _activeTgMenuCtx$msg === void 0 ? void 0 : _activeTgMenuCtx$msg.text) || '';
    closeTelegramMsgMenu();
    if (txt) {
      navigator.clipboard.writeText(txt).then(() => showToast('Скопировано в буфер обмена')).catch(() => {});
    }
  });
  (_$66 = $('tgMenuEditBtn')) === null || _$66 === void 0 || _$66.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    var _activeTgMenuCtx4 = activeTgMenuCtx,
      msg = _activeTgMenuCtx4.msg,
      composerTarget = _activeTgMenuCtx4.composerTarget,
      friendId = _activeTgMenuCtx4.friendId;
    closeTelegramMsgMenu();
    setComposerEdit(composerTarget, msg, friendId);
  });
  (_$67 = $('tgMenuDeleteBtn')) === null || _$67 === void 0 || _$67.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    var _activeTgMenuCtx5 = activeTgMenuCtx,
      msg = _activeTgMenuCtx5.msg,
      contextType = _activeTgMenuCtx5.contextType,
      friendId = _activeTgMenuCtx5.friendId;
    closeTelegramMsgMenu();
    handleDeleteMessage(msg, contextType, friendId);
  });
  function getMsgDayKey(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function formatMsgDayLabel(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var todayKey = getMsgDayKey(now);
    var yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    var yesterdayKey = getMsgDayKey(yesterday);
    var key = getMsgDayKey(d);
    if (key === todayKey) return 'Сегодня';
    if (key === yesterdayKey) return 'Вчера';
    var opts = {
      day: 'numeric',
      month: 'long'
    };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('ru-RU', opts);
  }
  function renderTickIcon(isRead) {
    if (isRead) {
      return `<span class="chat-ticks read" title="Прочитано"><svg class="chat-tick-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg></span>`;
    }
    return `<span class="chat-ticks" title="Отправлено"><svg class="chat-tick-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;
  }
  function buildRichBubbleInner(msg, options = {}) {
    var _options$showAuthor = options.showAuthor,
      showAuthor = _options$showAuthor === void 0 ? false : _options$showAuthor,
      _options$isOwn = options.isOwn,
      isOwn = _options$isOwn === void 0 ? false : _options$isOwn,
      _options$contextType = options.contextType,
      contextType = _options$contextType === void 0 ? 'room' : _options$contextType;
    var u = msg.user || msg.sender || {};
    var html = '';
    if (showAuthor && !isOwn) {
      html += `<div class="chat-author" style="color:${esc(u.color || '#00e676')}">${esc(u.displayName || 'Пользователь')}</div>`;
    }
    if (msg.replyTo && msg.replyTo.id) {
      html += `
        <div class="msg-reply-quote" data-scroll-msg="${esc(msg.replyTo.id)}">
          <div class="msg-reply-author">${esc(msg.replyTo.senderName || 'Сообщение')}</div>
          <div class="msg-reply-text">${esc(msg.replyTo.text || '📷 Фотография')}</div>
        </div>
      `;
    }
    if (msg.viewOnce) {
      if (msg.viewed) {
        html += `
          <div class="tg-viewonce-card viewed">
            <div class="tg-viewonce-icon">💨</div>
            <div class="tg-viewonce-info">
              <div class="tg-viewonce-title">Фотография</div>
              <div class="tg-viewonce-sub">Просмотрено</div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="tg-viewonce-card" data-open-viewonce="1">
            <div class="tg-viewonce-icon">1</div>
            <div class="tg-viewonce-info">
              <div class="tg-viewonce-title">Фотография</div>
              <div class="tg-viewonce-sub">${isOwn ? 'Одноразовое · Отправлено' : 'Нажмите для просмотра'}</div>
            </div>
          </div>
        `;
      }
    } else if (msg.imageUrl) {
      html += `<img class="msg-photo" src="${esc(msg.imageUrl)}" alt="Фото" loading="lazy" />`;
    }
    var timeStr = formatMsgTime(msg.createdAt);
    var editedTag = msg.editedAt ? 'изм. ' : '';
    var ticksHtml = contextType === 'dm' && isOwn ? renderTickIcon(!!msg.read) : '';
    var metaInline = `<span class="chat-meta-inline">${esc(editedTag)}${esc(timeStr)}${ticksHtml}</span>`;
    if (msg.text) {
      html += `<div class="chat-text-wrap"><span class="chat-text">${esc(msg.text)}</span>${metaInline}</div>`;
    } else {
      html += `<div class="chat-text-wrap">${metaInline}</div>`;
    }
    var reactions = msg.reactions || {};
    var rxEntries = Object.entries(reactions).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
    if (rxEntries.length > 0) {
      html += `<div class="msg-reactions-bar">` + rxEntries.map(([emoji, users]) => {
        var mine = state.user && users.includes(state.user.id);
        return `<button type="button" class="msg-rx-pill ${mine ? 'mine' : ''}" data-rx="${esc(emoji)}"><span>${esc(emoji)}</span><span>${users.length}</span></button>`;
      }).join('') + `</div>`;
    }
    return html;
  }
  function bindRichMessageEvents(el, msg, contextType, composerTarget, friendId = null) {
    var u = msg.user || msg.sender || {};
    var av = el.querySelector('.chat-av');
    if (av && u.id) av.onclick = e => {
      e.stopPropagation();
      openUserCard(u.id);
    };
    var photo = el.querySelector('.msg-photo');
    if (photo && msg.imageUrl) {
      photo.onclick = e => {
        e.stopPropagation();
        openPhotoLightbox(msg.imageUrl, msg.text || '', false);
      };
    }
    var voBtn = el.querySelector('[data-open-viewonce]');
    if (voBtn) {
      voBtn.onclick = e => {
        e.stopPropagation();
        handleViewOnceClick(msg, contextType, friendId);
      };
    }
    var quote = el.querySelector('[data-scroll-msg]');
    if (quote) {
      quote.onclick = e => {
        e.stopPropagation();
        var targetEl = document.querySelector(`[data-msg-id="${CSS.escape(msg.replyTo.id)}"]`);
        if (targetEl) {
          targetEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
          targetEl.classList.add('context-active');
          setTimeout(() => targetEl.classList.remove('context-active'), 1100);
        }
      };
    }
    el.querySelectorAll('[data-rx]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        handleToggleMessageReaction(msg, btn.dataset.rx, contextType, friendId);
      };
    });
    var ctxObj = {
      msg,
      el,
      contextType,
      composerTarget,
      friendId
    };
    var bubble = el.querySelector('.chat-bubble');
    var hoverTrig = el.querySelector('.tg-hover-trigger');
    if (hoverTrig) {
      hoverTrig.onclick = e => {
        e.stopPropagation();
        openTelegramMsgMenu(e.clientX, e.clientY, ctxObj);
      };
    }
    if (bubble) {
      bubble.addEventListener('contextmenu', e => {
        e.preventDefault();
        openTelegramMsgMenu(e.clientX, e.clientY, ctxObj);
      });
      bubble.addEventListener('dblclick', e => {
        e.preventDefault();
        setComposerReply(composerTarget, msg);
      });
      bubble.addEventListener('click', e => {
        if (e.target.closest('.msg-photo, [data-open-viewonce], .msg-reply-quote, .msg-rx-pill')) return;
        if (window.getSelection && String(window.getSelection()).length > 0) return;
        openTelegramMsgMenu(e.clientX, e.clientY, ctxObj);
      });
      var touchStartX = 0;
      var touchStartY = 0;
      var swipedReply = false;
      bubble.addEventListener('touchstart', e => {
        var t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        swipedReply = false;
      }, {
        passive: true
      });
      bubble.addEventListener('touchmove', e => {
        var t = e.touches[0];
        var dx = t.clientX - touchStartX;
        var dy = Math.abs(t.clientY - touchStartY);
        if (dx < -18 && dy < 30) {
          var shift = Math.max(-56, dx);
          el.style.transform = `translateX(${shift}px)`;
          if (dx < -46 && !swipedReply) {
            swipedReply = true;
          }
        }
      }, {
        passive: true
      });
      bubble.addEventListener('touchend', () => {
        el.style.transform = '';
        if (swipedReply) {
          setComposerReply(composerTarget, msg);
        }
      });
    }
  }
  function createRichMessageElement(msg, contextType = 'room', composerTarget = 'room', friendId = null) {
    var _msg$user3;
    var el = document.createElement('div');
    el.dataset.msgId = msg.id || '';
    if (msg.system) {
      el.className = 'chat-msg system';
      el.textContent = msg.text;
      return el;
    }
    var uid = msg.fromId || ((_msg$user3 = msg.user) === null || _msg$user3 === void 0 ? void 0 : _msg$user3.id) || '';
    var isOwn = !!(state.user && uid === state.user.id);
    var u = msg.user || msg.sender || (isOwn ? state.user : {});
    el.className = `chat-msg ${isOwn ? 'own' : ''}`;
    el.dataset.authorId = uid;
    el.dataset.dayKey = getMsgDayKey(msg.createdAt);
    el.dataset.createdAt = msg.createdAt || '';
    el.dataset.msgSig = JSON.stringify({
      t: msg.text,
      e: msg.editedAt,
      v: msg.viewed,
      r: msg.read,
      rx: msg.reactions
    });
    el.innerHTML = `
      <div class="chat-av" style="background:${esc((u === null || u === void 0 ? void 0 : u.color) || '#00e676')}">${avatarInnerHtml(u)}</div>
      <div class="chat-msg-body">
        <div class="chat-bubble">
          ${buildRichBubbleInner(msg, {
      showAuthor: contextType === 'room',
      isOwn,
      contextType
    })}
        </div>
      </div>
    `;
    bindRichMessageEvents(el, msg, contextType, composerTarget, friendId);
    return el;
  }
  function refreshMessageGrouping(container) {
    if (!container) return;
    container.querySelectorAll('.chat-day-divider').forEach(d => d.remove());
    var items = Array.from(container.querySelectorAll('.chat-msg'));
    var lastDayKey = '';
    for (var i = 0; i < items.length; i++) {
      var cur = items[i];
      var prev = items[i - 1];
      var next = items[i + 1];
      var curDay = cur.dataset.dayKey || '';
      if (curDay && curDay !== lastDayKey) {
        var div = document.createElement('div');
        div.className = 'chat-day-divider';
        div.dataset.day = curDay;
        div.innerHTML = `<span>${esc(formatMsgDayLabel(cur.dataset.createdAt))}</span>`;
        container.insertBefore(div, cur);
        lastDayKey = curDay;
      }
      var curAuthor = cur.dataset.authorId;
      if (!curAuthor || cur.classList.contains('system')) continue;
      var samePrev = prev && !prev.classList.contains('system') && prev.dataset.authorId === curAuthor && (prev.dataset.dayKey || '') === curDay;
      var sameNext = next && !next.classList.contains('system') && next.dataset.authorId === curAuthor && (next.dataset.dayKey || '') === curDay;
      cur.classList.toggle('grouped-prev', !!samePrev);
      cur.classList.toggle('grouped-next', !!sameNext);
    }
    var typingRow = container.querySelector('.chat-typing-row');
    if (typingRow) container.appendChild(typingRow);
  }
  var dmTypingUsers = new Map();
  var roomTypingUsers = new Map();
  var localTypingTimers = new Map();
  function renderTypingDotsHtml() {
    return '<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
  }
  function updateChatBoxTypingBubble(boxId, typers) {
    var box = $(boxId);
    if (!box) return;
    var row = box.querySelector('.chat-typing-row');
    if (!typers || typers.length === 0) {
      if (row) row.remove();
      return;
    }
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    var first = typers[0];
    var labelText = boxId === 'chatMessages' ? typers.length === 1 ? `${first.displayName} печатает` : `${first.displayName} и ещё ${typers.length - 1} печатают` : '';
    if (!row) {
      row = document.createElement('div');
      row.className = 'chat-typing-row';
      box.appendChild(row);
    } else if (box.lastElementChild !== row) {
      box.appendChild(row);
    }
    row.innerHTML = `
      <div class="chat-av" style="background:${esc(first.color || '#00e676')}">${avatarInnerHtml(first)}</div>
      <div class="chat-typing-bubble">
        ${labelText ? `<span class="chat-typing-label">${esc(labelText)}</span>` : ''}
        ${renderTypingDotsHtml()}
      </div>
    `;
    if (nearBottom) {
      box.scrollTop = box.scrollHeight;
    }
  }
  function syncDmTypingUi(friendId) {
    var entry = dmTypingUsers.get(friendId);
    var typers = entry ? [entry] : [];
    if (activeDmFriendId === friendId) {
      updateChatBoxTypingBubble('dmMessages', typers);
      var friend = state.friends.find(x => x.id === friendId);
      if (friend) updateDmHeader(friend);
    }
    if (roomActiveDmFriendId === friendId) {
      updateChatBoxTypingBubble('roomDmMessages', typers);
    }
    renderFriendsView();
    renderRoomDmFriendsList();
  }
  function syncRoomTypingUi() {
    var typers = Array.from(roomTypingUsers.values());
    updateChatBoxTypingBubble('chatMessages', typers);
  }
  function emitLocalTyping(kind, targetId = '', isTyping = true) {
    if (!socket || !socket.connected || !state.user) return;
    var key = `${kind}:${targetId}`;
    var prev = localTypingTimers.get(key) || {
      lastSent: 0,
      stopTimer: null
    };
    clearTimeout(prev.stopTimer);
    if (!isTyping) {
      if (prev.lastSent > 0) {
        if (kind === 'dm' && targetId) socket.emit('dm:typing', {
          toId: targetId,
          typing: false
        });else if (kind === 'room') socket.emit('chat:typing', {
          typing: false
        });
      }
      localTypingTimers.delete(key);
      return;
    }
    var now = Date.now();
    if (now - prev.lastSent > 1400) {
      prev.lastSent = now;
      if (kind === 'dm' && targetId) socket.emit('dm:typing', {
        toId: targetId,
        typing: true
      });else if (kind === 'room') socket.emit('chat:typing', {
        typing: true
      });
    }
    prev.stopTimer = setTimeout(() => {
      emitLocalTyping(kind, targetId, false);
    }, 2600);
    localTypingTimers.set(key, prev);
  }
  socket.on('dm:typing_state', ({
    fromId,
    displayName,
    avatar,
    avatarUrl,
    color,
    typing
  }) => {
    if (!fromId || state.user && fromId === state.user.id) return;
    var existing = dmTypingUsers.get(fromId);
    if (existing !== null && existing !== void 0 && existing.timer) clearTimeout(existing.timer);
    if (typing) {
      var timer = setTimeout(() => {
        dmTypingUsers.delete(fromId);
        syncDmTypingUi(fromId);
      }, 3600);
      dmTypingUsers.set(fromId, {
        id: fromId,
        displayName: displayName || 'Друг',
        avatar,
        avatarUrl,
        color,
        timer
      });
    } else {
      dmTypingUsers.delete(fromId);
    }
    syncDmTypingUi(fromId);
  });
  socket.on('chat:typing_state', ({
    userId,
    displayName,
    avatar,
    avatarUrl,
    color,
    typing
  }) => {
    if (!userId || state.user && userId === state.user.id) return;
    var existing = roomTypingUsers.get(userId);
    if (existing !== null && existing !== void 0 && existing.timer) clearTimeout(existing.timer);
    if (typing) {
      var timer = setTimeout(() => {
        roomTypingUsers.delete(userId);
        syncRoomTypingUi();
      }, 3600);
      roomTypingUsers.set(userId, {
        id: userId,
        displayName: displayName || 'Участник',
        avatar,
        avatarUrl,
        color,
        timer
      });
    } else {
      roomTypingUsers.delete(userId);
    }
    syncRoomTypingUi();
  });
  function updateChatMessageDom(msg, contextType = 'room') {
    if (!msg || !msg.id) return;
    document.querySelectorAll(`[data-msg-id="${CSS.escape(msg.id)}"]`).forEach(existing => {
      var parent = existing.parentElement;
      var parentId = (parent === null || parent === void 0 ? void 0 : parent.id) || '';
      var composerTarget = parentId === 'roomDmMessages' ? 'roomDm' : parentId === 'dmMessages' ? 'dm' : 'room';
      var friendId = composerTarget === 'roomDm' ? roomActiveDmFriendId : activeDmFriendId;
      var fresh = createRichMessageElement(msg, contextType, composerTarget, friendId);
      existing.replaceWith(fresh);
      refreshMessageGrouping(parent);
    });
  }
  function removeChatMessageDom(messageId) {
    if (!messageId) return;
    document.querySelectorAll(`[data-msg-id="${CSS.escape(messageId)}"]`).forEach(existing => {
      var parent = existing.parentElement;
      existing.remove();
      refreshMessageGrouping(parent);
    });
  }
  function syncRoomMessagesFromPoll(messages) {
    var box = $('chatMessages');
    if (!box) return;
    var validIds = new Set(messages.map(m => m.id));
    box.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
      if (el.dataset.msgId && !validIds.has(el.dataset.msgId)) el.remove();
    });
    messages.forEach(m => {
      var existing = box.querySelector(`[data-msg-id="${CSS.escape(m.id)}"]`);
      if (!existing) {
        appendChatMessage(m, true);
      } else {
        var nextSig = JSON.stringify({
          t: m.text,
          e: m.editedAt,
          v: m.viewed,
          r: m.read,
          rx: m.reactions
        });
        if (existing.dataset.msgSig !== nextSig) {
          updateChatMessageDom(m, 'room');
        }
      }
    });
    refreshMessageGrouping(box);
  }
  function syncDmMessagesFromPoll(friendId, messages) {
    ['dmMessages', 'roomDmMessages'].forEach(boxId => {
      var box = $(boxId);
      if (!box) return;
      var isTarget = boxId === 'dmMessages' && activeDmFriendId === friendId || boxId === 'roomDmMessages' && roomActiveDmFriendId === friendId;
      if (!isTarget) return;
      var validIds = new Set(messages.map(m => m.id));
      box.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
        if (el.dataset.msgId && !validIds.has(el.dataset.msgId)) el.remove();
      });
      messages.forEach(m => {
        var existing = box.querySelector(`[data-msg-id="${CSS.escape(m.id)}"]`);
        if (!existing) {
          if (box.querySelector('div[style*="text-align:center"]')) box.innerHTML = '';
          var compTarget = boxId === 'roomDmMessages' ? 'roomDm' : 'dm';
          box.appendChild(createRichMessageElement(m, 'dm', compTarget, friendId));
          box.scrollTop = box.scrollHeight;
          if (state.user && m.fromId !== state.user.id && !notifiedDmIds.has(m.id)) {
            notifiedDmIds.add(m.id);
            var friend = state.friends.find(x => x.id === friendId) || m.sender || {
              id: friendId,
              displayName: 'Друг'
            };
            var preview = m.text || (m.viewOnce ? '💣 Одноразовое фото' : '📷 Фотография');
            triggerAppNotification({
              title: friend.displayName || 'Друг',
              body: preview,
              user: friend,
              data: {
                friendId,
                tag: 'dm-msg-' + m.id
              },
              onClick: () => {
                if (state.currentView === 'room') {
                  setMobileRoomTab('dms');
                  openRoomDmChat(friendId);
                } else {
                  switchView('friends');
                  openFriendChat(friendId);
                }
              }
            });
          }
        } else {
          var nextSig = JSON.stringify({
            t: m.text,
            e: m.editedAt,
            v: m.viewed,
            r: m.read,
            rx: m.reactions
          });
          if (existing.dataset.msgSig !== nextSig) {
            updateChatMessageDom(m, 'dm');
          }
        }
      });
      refreshMessageGrouping(box);
    });
  }
  function updateVoiceSettingsUi() {
    var active = !!state.voiceActive;
    var voiceToggleBtn = $('voiceToggleBtn');
    if (voiceToggleBtn) voiceToggleBtn.classList.toggle('active', active);
    var voiceBtn = $('settingsVoiceToggleBtn');
    var voiceSub = $('settingsVoiceSub');
    var voiceBadge = $('settingsVoiceBadge');
    if (voiceBtn) voiceBtn.classList.toggle('active', active);
    if (voiceSub) voiceSub.textContent = active ? 'Микрофон включен' : 'Микрофон отключен';
    if (voiceBadge) voiceBadge.textContent = active ? 'Отключить' : 'Включить';
  }
  function openRoomSettingsModal() {
    if (!state.room) return;
    var room = state.room;
    if ($('settingsRoomCode')) $('settingsRoomCode').textContent = `#${room.code}`;
    if ($('settingsModalRoomTitle')) $('settingsModalRoomTitle').textContent = room.name || 'Комната';
    if ($('settingsRoomNameInput')) $('settingsRoomNameInput').value = room.name || '';
    var isHost = state.user && (room.hostId === state.user.id || room.creatorId === state.user.id);
    var hostGroup = $('settingsHostGroup');
    if (hostGroup) hostGroup.style.display = isHost ? 'flex' : 'none';
    var hostOnlyToggle = $('settingsHostOnlyToggle');
    if (hostOnlyToggle) hostOnlyToggle.checked = !!room.hostOnlyControl;
    var hostOnlySub = $('settingsHostOnlySub');
    if (hostOnlySub) {
      hostOnlySub.textContent = room.hostOnlyControl ? 'Только создатель ставит паузу и меняет видео' : 'Зрители могут ставить паузу и менять видео';
    }
    var privBadge = $('settingsModalPrivacyBadge');
    if (privBadge) {
      privBadge.textContent = room.isPublic ? 'Публичная' : 'Приватная';
      privBadge.className = `badge tiny ${room.isPublic ? 'accent' : ''}`;
    }
    var privAction = $('settingsPrivacyAction');
    if (privAction) {
      privAction.textContent = room.isPublic ? 'Сделать приватной' : 'Сделать публичной';
    }
    var privIcon = $('settingsPrivacyIcon');
    if (privIcon) {
      privIcon.innerHTML = room.isPublic ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    }
    var privSub = $('settingsPrivacySub');
    if (privSub) {
      privSub.textContent = room.isPublic ? 'В общем каталоге комнат' : 'Доступ только по прямой ссылке';
    }
    updateVoiceSettingsUi();
    openModal('roomSettingsModal');
  }
  function toggleRoomPrivacy() {
    if (!state.room) return;
    var nextPublic = !state.room.isPublic;
    state.room.isPublic = nextPublic;
    socket.emit('room:settings', {
      isPublic: nextPublic
    });
    if (!socket.connected) {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify({
          settings: {
            isPublic: nextPublic
          }
        })
      }).catch(() => {});
    }
    var privBadge = $('settingsModalPrivacyBadge');
    if (privBadge) {
      privBadge.textContent = nextPublic ? 'Публичная' : 'Приватная';
      privBadge.className = `badge tiny ${nextPublic ? 'accent' : ''}`;
    }
    var roomBadge = $('roomPrivacyBadge');
    if (roomBadge) {
      roomBadge.textContent = nextPublic ? 'Публичная' : 'Приватная';
      roomBadge.className = `badge tiny ${nextPublic ? 'accent' : ''}`;
    }
    var privAction = $('settingsPrivacyAction');
    if (privAction) privAction.textContent = nextPublic ? 'Сделать приватной' : 'Сделать публичной';
    var privIcon = $('settingsPrivacyIcon');
    if (privIcon) {
      privIcon.innerHTML = nextPublic ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    }
    var privSub = $('settingsPrivacySub');
    if (privSub) privSub.textContent = nextPublic ? 'В общем каталоге комнат' : 'Доступ только по прямой ссылке';
    showToast(nextPublic ? 'Комната теперь публичная' : 'Комната теперь приватная (только по коду/ссылке)');
  }
  function renderRoomHeader(room) {
    var _$68;
    $('roomTitleText').textContent = room.name;
    var privBadge = $('roomPrivacyBadge');
    if (privBadge) {
      privBadge.textContent = room.isPublic ? 'Публичная' : 'Приватная';
      privBadge.className = `badge tiny ${room.isPublic ? 'accent' : ''}`;
    }
    $('roomCodeLabel').textContent = `#${room.code}`;
    if ($('roomCodeOptionsDisplay')) $('roomCodeOptionsDisplay').textContent = `#${room.code}`;
    if ($('settingsRoomCode')) $('settingsRoomCode').textContent = `#${room.code}`;
    (_$68 = $('roomSettingsBtn')) === null || _$68 === void 0 || _$68.classList.remove('hidden');
  }
  (_$69 = $('roomSettingsBtn')) === null || _$69 === void 0 || _$69.addEventListener('click', openRoomSettingsModal);
  (_$70 = $('viewersInviteBtn')) === null || _$70 === void 0 || _$70.addEventListener('click', () => {
    var _$71;
    return (_$71 = $('inviteFriendsModalBtn')) === null || _$71 === void 0 ? void 0 : _$71.click();
  });
  (_$72 = $('settingsInviteFriendsBtn')) === null || _$72 === void 0 || _$72.addEventListener('click', () => {
    var _$73;
    closeModal('roomSettingsModal');
    (_$73 = $('inviteFriendsModalBtn')) === null || _$73 === void 0 || _$73.click();
  });
  (_$74 = $('settingsVoiceToggleBtn')) === null || _$74 === void 0 || _$74.addEventListener('click', () => {
    toggleVoiceChat();
    updateVoiceSettingsUi();
  });
  (_$75 = $('settingsTogglePrivacyBtn')) === null || _$75 === void 0 || _$75.addEventListener('click', toggleRoomPrivacy);
  (_$76 = $('settingsSaveRoomNameBtn')) === null || _$76 === void 0 || _$76.addEventListener('click', () => {
    var _$77;
    if (!state.room) return;
    var nextName = (((_$77 = $('settingsRoomNameInput')) === null || _$77 === void 0 ? void 0 : _$77.value) || '').trim();
    if (!nextName) return;
    state.room.name = nextName;
    if ($('roomTitleText')) $('roomTitleText').textContent = nextName;
    if ($('settingsModalRoomTitle')) $('settingsModalRoomTitle').textContent = nextName;
    socket.emit('room:settings', {
      name: nextName
    });
    if (!socket.connected) {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify({
          settings: {
            name: nextName
          }
        })
      }).catch(() => {});
    }
    showToast('Название комнаты сохранено');
  });
  (_$78 = $('settingsRoomNameInput')) === null || _$78 === void 0 || _$78.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      var _$79;
      e.preventDefault();
      (_$79 = $('settingsSaveRoomNameBtn')) === null || _$79 === void 0 || _$79.click();
    }
  });
  (_$80 = $('settingsHostOnlyToggle')) === null || _$80 === void 0 || _$80.addEventListener('change', e => {
    if (!state.room) return;
    var hostOnly = !!e.target.checked;
    state.room.hostOnlyControl = hostOnly;
    var hostOnlySub = $('settingsHostOnlySub');
    if (hostOnlySub) {
      hostOnlySub.textContent = hostOnly ? 'Только создатель ставит паузу и меняет видео' : 'Зрители могут ставить паузу и менять видео';
    }
    socket.emit('room:settings', {
      hostOnlyControl: hostOnly
    });
    if (!socket.connected) {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify({
          settings: {
            hostOnlyControl: hostOnly
          }
        })
      }).catch(() => {});
    }
    showToast(hostOnly ? 'Управление плеером: только создатель' : 'Управление плеером: все зрители');
  });
  (_$81 = $('settingsResyncBtn')) === null || _$81 === void 0 || _$81.addEventListener('click', () => {
    var _$82;
    closeModal('roomSettingsModal');
    (_$82 = $('resyncPlayerBtn')) === null || _$82 === void 0 || _$82.click();
  });
  (_$83 = $('settingsTvRemoteBtn')) === null || _$83 === void 0 || _$83.addEventListener('click', () => {
    closeModal('roomSettingsModal');
    openModal('tvRemoteModal');
  });
  (_$84 = $('settingsLeaveRoomBtn')) === null || _$84 === void 0 || _$84.addEventListener('click', () => {
    closeModal('roomSettingsModal');
    leaveRoom();
  });
  function renderRoomParticipants(list) {
    $('roomUserCount').textContent = list.length;
    var mobCnt = $('roomUserCountMobile');
    if (mobCnt) mobCnt.textContent = list.length;
    var headCnt = $('roomViewersHeadCount');
    if (headCnt) headCnt.textContent = list.length;
    var container = $('roomParticipantsList');
    container.innerHTML = '';
    list.forEach(p => {
      var isHost = state.room && p.id === state.room.hostId;
      var row = document.createElement('div');
      row.className = 'user-row viewer-card-row';
      row.innerHTML = `
        <div class="user-row-left">
          <div class="viewer-avatar-wrap">
            <div class="avatar-circle" style="background:${esc(p.color || '#00e676')}">${avatarInnerHtml(p)}</div>
            <span class="viewer-online-dot"></span>
          </div>
          <div class="viewer-meta-col">
            <div class="user-row-name">
              <span>${esc(p.displayName)}</span>
              ${isHost ? '<span class="viewer-role-badge">Хост</span>' : ''}
              ${p.inVoice ? '<span class="viewer-voice-badge">В эфире</span>' : ''}
            </div>
            <div class="user-row-sub">@${esc(p.username)}</div>
          </div>
        </div>
        <svg class="viewer-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      `;
      row.addEventListener('click', () => openUserCard(p.id));
      container.appendChild(row);
    });
  }
  function renderRoomMessages(messages) {
    var box = $('chatMessages');
    box.innerHTML = '';
    messages.forEach(m => {
      if (m.id) notifiedDmIds.add(m.id);
      appendChatMessage(m, false);
    });
  }
  function spawnVideoChatPill(msg) {
    if (!msg || msg.system || !msg.user) return;
    var overlay = $('videoChatOverlay');
    if (!overlay) return;
    var pill = document.createElement('div');
    pill.className = 'vchat-pill';
    var preview = msg.text || (msg.viewOnce ? '💣 Одноразовое фото' : '📷 Фото');
    pill.innerHTML = `<strong>${esc(msg.user.displayName)}:</strong> <span>${esc(preview)}</span>`;
    overlay.appendChild(pill);
    while (overlay.children.length > 3) {
      overlay.firstElementChild.remove();
    }
    setTimeout(() => {
      if (pill.parentNode) pill.remove();
    }, 4500);
  }
  function appendChatMessage(msg, isLive = false) {
    var _msg$user4;
    var box = $('chatMessages');
    if (msg.id && box.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) return;
    if ((_msg$user4 = msg.user) !== null && _msg$user4 !== void 0 && _msg$user4.id && roomTypingUsers.has(msg.user.id)) {
      var t = roomTypingUsers.get(msg.user.id);
      if (t !== null && t !== void 0 && t.timer) clearTimeout(t.timer);
      roomTypingUsers.delete(msg.user.id);
      syncRoomTypingUi();
    }
    var el = createRichMessageElement(msg, 'room', 'room', null);
    if (!msg.system && isLive) {
      var _msg$user5;
      spawnVideoChatPill(msg);
      var isOwn = state.user && ((_msg$user5 = msg.user) === null || _msg$user5 === void 0 ? void 0 : _msg$user5.id) === state.user.id;
      if (!isOwn && (!msg.id || !notifiedDmIds.has(msg.id))) {
        var _msg$user6, _state$room0;
        if (msg.id) notifiedDmIds.add(msg.id);
        if (state.mobileRoomTab !== 'chat') {
          state.unreadChatCount++;
          var badge = $('chatUnreadBadge');
          if (badge) {
            badge.textContent = state.unreadChatCount;
            badge.classList.remove('hidden');
          }
        }
        var preview = msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : '📷 Фотография');
        triggerAppNotification({
          title: `${((_msg$user6 = msg.user) === null || _msg$user6 === void 0 ? void 0 : _msg$user6.displayName) || 'Участник'} (в комнате)`,
          body: preview,
          user: msg.user,
          data: {
            roomCode: (_state$room0 = state.room) === null || _state$room0 === void 0 ? void 0 : _state$room0.code,
            tag: 'roomchat-' + (msg.id || Date.now())
          },
          onClick: () => setMobileRoomTab('chat')
        });
      }
    }
    box.appendChild(el);
    refreshMessageGrouping(box);
    box.scrollTop = box.scrollHeight;
  }
  function sendActiveRoomChat() {
    return _sendActiveRoomChat.apply(this, arguments);
  }
  function _sendActiveRoomChat() {
    _sendActiveRoomChat = _asyncToGenerator(_regenerator().m(function _callee40() {
      var input, text, comp, editId, res, payload, _res3, _t35, _t36;
      return _regenerator().w(function (_context40) {
        while (1) switch (_context40.p = _context40.n) {
          case 0:
            if (state.room) {
              _context40.n = 1;
              break;
            }
            return _context40.a(2);
          case 1:
            input = $('chatInput');
            text = getChatInputValue(input);
            comp = composers.room;
            if (!comp.editingMsg) {
              _context40.n = 7;
              break;
            }
            editId = comp.editingMsg.id;
            clearChatInput(input);
            comp.editingMsg = null;
            renderComposerBar('room');
            if (text) {
              _context40.n = 2;
              break;
            }
            return _context40.a(2);
          case 2:
            if (!socket.connected) {
              _context40.n = 3;
              break;
            }
            socket.emit('chat:edit', {
              messageId: editId,
              text
            });
            _context40.n = 6;
            break;
          case 3:
            _context40.p = 3;
            _context40.n = 4;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/${encodeURIComponent(editId)}`, {
              method: 'PUT',
              body: JSON.stringify({
                text
              })
            });
          case 4:
            res = _context40.v;
            if (res.message) updateChatMessageDom(res.message, 'room');
            _context40.n = 6;
            break;
          case 5:
            _context40.p = 5;
            _t35 = _context40.v;
            showToast(_t35.message);
          case 6:
            return _context40.a(2);
          case 7:
            if (!(!text && !comp.imageUrl)) {
              _context40.n = 8;
              break;
            }
            return _context40.a(2);
          case 8:
            payload = {
              text,
              imageUrl: comp.imageUrl || '',
              viewOnce: !!comp.viewOnce,
              replyTo: comp.replyTo || null
            };
            clearChatInput(input);
            emitLocalTyping('room', '', false);
            focusChatInput(input);
            comp.imageUrl = '';
            comp.viewOnce = false;
            comp.replyTo = null;
            renderComposerBar('room');
            _context40.p = 9;
            _context40.n = 10;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat`, {
              method: 'POST',
              body: JSON.stringify(payload)
            });
          case 10:
            _res3 = _context40.v;
            if (_res3.message) appendChatMessage(_res3.message, false);
            _context40.n = 12;
            break;
          case 11:
            _context40.p = 11;
            _t36 = _context40.v;
            showToast(_t36.message);
          case 12:
            return _context40.a(2);
        }
      }, _callee40, null, [[9, 11], [3, 5]]);
    }));
    return _sendActiveRoomChat.apply(this, arguments);
  }
  attachChatInputHandlers('chatInput', 'chatSendBtn', sendActiveRoomChat);
  (_$85 = $('chatInput')) === null || _$85 === void 0 || _$85.addEventListener('input', e => {
    var val = (e.target.value || '').trim();
    emitLocalTyping('room', '', val.length > 0);
  });
  function setMobileRoomTab(tabName) {
    state.mobileRoomTab = tabName;
    var layout = document.querySelector('.room-layout');
    document.querySelectorAll('.m-rtab').forEach(b => {
      b.classList.toggle('active', b.dataset.mrtab === tabName);
    });
    if (tabName === 'z01') {
      var _$86;
      layout === null || layout === void 0 || layout.classList.add('mobile-tab-z01');
      (_$86 = $('z01Panel')) === null || _$86 === void 0 || _$86.classList.remove('hidden');
    } else {
      var _$87;
      layout === null || layout === void 0 || layout.classList.remove('mobile-tab-z01');
      var validTabs = ['chat', 'users', 'dms', 'options'];
      var rtab = validTabs.includes(tabName) ? tabName : 'chat';
      document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t.dataset.rtab === rtab));
      document.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
      (_$87 = $(`rtab-${rtab}`)) === null || _$87 === void 0 || _$87.classList.add('active');
      if (rtab === 'chat') {
        var _$88;
        state.unreadChatCount = 0;
        (_$88 = $('chatUnreadBadge')) === null || _$88 === void 0 || _$88.classList.add('hidden');
        var box = $('chatMessages');
        if (box) box.scrollTop = box.scrollHeight;
      } else if (rtab === 'dms') {
        renderRoomDmFriendsList();
      } else if (rtab === 'options') {
        openRoomSettingsModal();
      }
    }
  }
  document.querySelectorAll('.m-rtab').forEach(btn => {
    btn.addEventListener('click', () => setMobileRoomTab(btn.dataset.mrtab));
  });
  function checkMobileOrientation() {
    var isLandscape = window.innerWidth > window.innerHeight && window.innerHeight <= 600;
    if (isLandscape) {
      var _$89;
      document.body.classList.add('mobile-landscape');
      if (state.room || (_$89 = $('view-room')) !== null && _$89 !== void 0 && _$89.classList.contains('active')) {
        setMobileRoomTab('chat');
      }
    } else {
      document.body.classList.remove('mobile-landscape');
    }
  }
  window.addEventListener('resize', checkMobileOrientation);
  window.addEventListener('orientationchange', () => {
    setTimeout(checkMobileOrientation, 60);
    setTimeout(checkMobileOrientation, 220);
  });
  document.querySelectorAll('.side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      var _$90;
      var rtab = tab.dataset.rtab;
      document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
      (_$90 = $(`rtab-${rtab}`)) === null || _$90 === void 0 || _$90.classList.add('active');
      if (rtab === 'chat') {
        var _$91;
        state.unreadChatCount = 0;
        (_$91 = $('chatUnreadBadge')) === null || _$91 === void 0 || _$91.classList.add('hidden');
        var box = $('chatMessages');
        if (box) box.scrollTop = box.scrollHeight;
      } else if (rtab === 'dms') {
        renderRoomDmFriendsList();
      } else if (rtab === 'options') {
        openRoomSettingsModal();
      }
    });
  });
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('room:reaction', {
        emoji: btn.dataset.emoji
      });
      if (!socket.connected) spawnFloatingEmoji(btn.dataset.emoji);
    });
  });
  function spawnFloatingEmoji(emoji) {
    var layer = $('reactionsLayer');
    var el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = `${15 + Math.random() * 70}%`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  var activeDmFriendId = null;
  var roomActiveDmFriendId = null;
  function formatMsgTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  function formatDialogListTime(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts) || ts);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var msgDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var diffDays = Math.round((todayStart - msgDayStart) / 86400000);
    if (diffDays <= 0) {
      return d.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    if (diffDays < 7) {
      var daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return daysShort[d.getDay()];
    }
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    if (d.getFullYear() === now.getFullYear()) {
      return `${dd}.${mm}`;
    }
    return `${dd}.${mm}.${String(d.getFullYear()).slice(-2)}`;
  }
  function updateDmBadges() {
    var _state$incomingReques;
    var unreadDmTotal = (state.friends || []).reduce((acc, f) => acc + (f.unreadCount || 0), 0);
    var totalNavBadge = (((_state$incomingReques = state.incomingRequests) === null || _state$incomingReques === void 0 ? void 0 : _state$incomingReques.length) || 0) + unreadDmTotal;
    var reqBadge = $('friendsReqBadge');
    if (totalNavBadge > 0) {
      reqBadge.textContent = totalNavBadge;
      reqBadge.classList.remove('hidden');
    } else {
      reqBadge.classList.add('hidden');
    }
    ['roomDmBadge', 'roomDmBadgeMobile'].forEach(id => {
      var b = $(id);
      if (!b) return;
      if (unreadDmTotal > 0) {
        b.textContent = unreadDmTotal;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });
  }
  function inviteFriendToCurrentRoom(_x26) {
    return _inviteFriendToCurrentRoom.apply(this, arguments);
  }
  function _inviteFriendToCurrentRoom() {
    _inviteFriendToCurrentRoom = _asyncToGenerator(_regenerator().m(function _callee41(friendId) {
      var _t37;
      return _regenerator().w(function (_context41) {
        while (1) switch (_context41.p = _context41.n) {
          case 0:
            if (!(!state.room || !friendId)) {
              _context41.n = 1;
              break;
            }
            return _context41.a(2);
          case 1:
            if (!socket.connected) {
              _context41.n = 2;
              break;
            }
            socket.emit('room:invite', {
              friendId
            });
            _context41.n = 5;
            break;
          case 2:
            _context41.p = 2;
            _context41.n = 3;
            return api(`/api/rooms/${encodeURIComponent(state.room.code)}/invite`, {
              method: 'POST',
              body: JSON.stringify({
                friendId
              })
            });
          case 3:
            showToast('🍿 Приглашение отправлено другу!');
            _context41.n = 5;
            break;
          case 4:
            _context41.p = 4;
            _t37 = _context41.v;
            showToast(_t37.message);
          case 5:
            return _context41.a(2);
        }
      }, _callee41, null, [[2, 4]]);
    }));
    return _inviteFriendToCurrentRoom.apply(this, arguments);
  }
  function loadFriends() {
    return _loadFriends.apply(this, arguments);
  }
  function _loadFriends() {
    _loadFriends = _asyncToGenerator(_regenerator().m(function _callee42() {
      var _data, newFriends, newIncoming, serverNotifs, _iterator5, _step5, _loop2, _iterator6, _step6, req, _iterator7, _step7, _loop3, _ret, f, _t39, _t40, _t41;
      return _regenerator().w(function (_context44) {
        while (1) switch (_context44.p = _context44.n) {
          case 0:
            if (state.user) {
              _context44.n = 1;
              break;
            }
            $('friendsList').innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">Войдите в аккаунт, чтобы добавлять друзей и переписываться с ними.</div>';
            return _context44.a(2);
          case 1:
            if (!friendsPollInFlight) {
              _context44.n = 2;
              break;
            }
            return _context44.a(2);
          case 2:
            friendsPollInFlight = true;
            _context44.p = 3;
            _context44.n = 4;
            return api('/api/friends');
          case 4:
            _data = _context44.v;
            newFriends = _data.friends || [];
            newIncoming = _data.incoming || [];
            serverNotifs = _data.notifications || [];
            _iterator5 = _createForOfIteratorHelper(newFriends);
            _context44.p = 5;
            _loop2 = _regenerator().m(function _loop2() {
              var f, incomingCandidates, _iterator8, _step8, msgItem, _t38;
              return _regenerator().w(function (_context42) {
                while (1) switch (_context42.p = _context42.n) {
                  case 0:
                    f = _step5.value;
                    incomingCandidates = Array.isArray(f.recentIncoming) && f.recentIncoming.length > 0 ? f.recentIncoming : f.lastMessage && f.lastMessage.fromId !== state.user.id ? [f.lastMessage] : [];
                    _iterator8 = _createForOfIteratorHelper(incomingCandidates);
                    _context42.p = 1;
                    _iterator8.s();
                  case 2:
                    if ((_step8 = _iterator8.n()).done) {
                      _context42.n = 5;
                      break;
                    }
                    msgItem = _step8.value;
                    if (!(!msgItem || !msgItem.id || msgItem.fromId === state.user.id)) {
                      _context42.n = 3;
                      break;
                    }
                    return _context42.a(3, 4);
                  case 3:
                    if (!initialFriendsLoaded) {
                      markDmNotified(msgItem.id);
                    } else if (!notifiedDmIds.has(msgItem.id)) {
                      markDmNotified(msgItem.id);
                      triggerAppNotification({
                        title: f.displayName,
                        body: msgItem.text || 'Новое сообщение',
                        user: f,
                        data: {
                          friendId: f.id,
                          tag: 'dm-msg-' + msgItem.id
                        },
                        onClick: () => {
                          if (state.currentView === 'room') {
                            setMobileRoomTab('dms');
                            openRoomDmChat(f.id);
                          } else {
                            switchView('friends');
                            openFriendChat(f.id);
                          }
                        }
                      });
                      if (activeDmFriendId === f.id || roomActiveDmFriendId === f.id) {
                        pollActiveDmChat();
                      }
                    }
                  case 4:
                    _context42.n = 2;
                    break;
                  case 5:
                    _context42.n = 7;
                    break;
                  case 6:
                    _context42.p = 6;
                    _t38 = _context42.v;
                    _iterator8.e(_t38);
                  case 7:
                    _context42.p = 7;
                    _iterator8.f();
                    return _context42.f(7);
                  case 8:
                    return _context42.a(2);
                }
              }, _loop2, null, [[1, 6, 7, 8]]);
            });
            _iterator5.s();
          case 6:
            if ((_step5 = _iterator5.n()).done) {
              _context44.n = 8;
              break;
            }
            return _context44.d(_regeneratorValues(_loop2()), 7);
          case 7:
            _context44.n = 6;
            break;
          case 8:
            _context44.n = 10;
            break;
          case 9:
            _context44.p = 9;
            _t39 = _context44.v;
            _iterator5.e(_t39);
          case 10:
            _context44.p = 10;
            _iterator5.f();
            return _context44.f(10);
          case 11:
            _iterator6 = _createForOfIteratorHelper(newIncoming);
            try {
              for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
                req = _step6.value;
                if (!initialFriendsLoaded) {
                  notifiedReqIds.add(req.id);
                } else if (!notifiedReqIds.has(req.id)) {
                  notifiedReqIds.add(req.id);
                  triggerAppNotification({
                    title: 'Новая заявка в друзья 👋',
                    body: `${req.user.displayName} (@${req.user.username}) хочет добавить вас в друзья`,
                    user: req.user,
                    kind: 'invite',
                    data: {
                      view: 'friends',
                      tag: 'freq-' + req.id
                    },
                    onClick: () => switchView('friends')
                  });
                }
              }
            } catch (err) {
              _iterator6.e(err);
            } finally {
              _iterator6.f();
            }
            _iterator7 = _createForOfIteratorHelper(serverNotifs);
            _context44.p = 12;
            _loop3 = _regenerator().m(function _loop3() {
              var n, _n$invitePayload, from, room, _n$from, _n$from2, senderId;
              return _regenerator().w(function (_context43) {
                while (1) switch (_context43.n) {
                  case 0:
                    n = _step7.value;
                    if (n) {
                      _context43.n = 1;
                      break;
                    }
                    return _context43.a(2, 0);
                  case 1:
                    if (initialFriendsLoaded) {
                      _context43.n = 2;
                      break;
                    }
                    if (n.id) notifiedEventIds.add(n.id);
                    if (n.msgId) markDmNotified(n.msgId);
                    return _context43.a(2, 0);
                  case 2:
                    if (!(n.id && notifiedEventIds.has(n.id))) {
                      _context43.n = 3;
                      break;
                    }
                    return _context43.a(2, 0);
                  case 3:
                    if (n.id) notifiedEventIds.add(n.id);
                    if (n.type === 'room_invite' && n.invitePayload) {
                      _n$invitePayload = n.invitePayload, from = _n$invitePayload.from, room = _n$invitePayload.room;
                      triggerAppNotification({
                        title: `${from.displayName} зовёт в комнату! 🍿`,
                        body: `Смотреть вместе: «${room.mediaTitle}»`,
                        user: from,
                        kind: 'invite',
                        data: {
                          roomCode: room.code,
                          tag: 'invite-' + (n.id || room.code)
                        },
                        onClick: () => joinRoomByCode(room.code)
                      });
                    } else if (n.type === 'dm_message') {
                      if (!n.msgId || !notifiedDmIds.has(n.msgId)) {
                        if (n.msgId) markDmNotified(n.msgId);
                        senderId = n.fromId || ((_n$from = n.from) === null || _n$from === void 0 ? void 0 : _n$from.id);
                        triggerAppNotification({
                          title: n.title || ((_n$from2 = n.from) === null || _n$from2 === void 0 ? void 0 : _n$from2.displayName) || 'Новое сообщение',
                          body: n.body || 'Новое сообщение',
                          user: n.from,
                          data: {
                            friendId: senderId,
                            tag: 'dm-msg-' + (n.msgId || n.id || Date.now())
                          },
                          onClick: () => {
                            if (!senderId) return switchView('friends');
                            if (state.currentView === 'room') {
                              setMobileRoomTab('dms');
                              openRoomDmChat(senderId);
                            } else {
                              switchView('friends');
                              openFriendChat(senderId);
                            }
                          }
                        });
                        if (senderId && (activeDmFriendId === senderId || roomActiveDmFriendId === senderId)) {
                          pollActiveDmChat();
                        }
                      }
                    } else if (n.title) {
                      triggerAppNotification({
                        title: n.title,
                        body: n.body || '',
                        kind: 'invite',
                        data: {
                          tag: 'ntf-' + (n.id || Date.now())
                        },
                        onClick: () => switchView('friends')
                      });
                    }
                  case 4:
                    return _context43.a(2);
                }
              }, _loop3);
            });
            _iterator7.s();
          case 13:
            if ((_step7 = _iterator7.n()).done) {
              _context44.n = 16;
              break;
            }
            return _context44.d(_regeneratorValues(_loop3()), 14);
          case 14:
            _ret = _context44.v;
            if (!(_ret === 0)) {
              _context44.n = 15;
              break;
            }
            return _context44.a(3, 15);
          case 15:
            _context44.n = 13;
            break;
          case 16:
            _context44.n = 18;
            break;
          case 17:
            _context44.p = 17;
            _t40 = _context44.v;
            _iterator7.e(_t40);
          case 18:
            _context44.p = 18;
            _iterator7.f();
            return _context44.f(18);
          case 19:
            initialFriendsLoaded = true;
            state.friends = newFriends;
            state.incomingRequests = newIncoming;
            state.outgoingRequests = _data.outgoing || [];
            updateDmBadges();
            renderFriendsView();
            renderRoomDmFriendsList();
            if (activeDmFriendId) {
              f = state.friends.find(x => x.id === activeDmFriendId);
              if (f) updateDmHeader(f);
            }
            _context44.n = 21;
            break;
          case 20:
            _context44.p = 20;
            _t41 = _context44.v;
          case 21:
            _context44.p = 21;
            friendsPollInFlight = false;
            return _context44.f(21);
          case 22:
            return _context44.a(2);
        }
      }, _callee42, null, [[12, 17, 18, 19], [5, 9, 10, 11], [3, 20, 21, 22]]);
    }));
    return _loadFriends.apply(this, arguments);
  }
  var lastTvBgSyncAt = 0;
  function runBackgroundSyncTick() {
    if (!state.user) return;
    if (state.tvMode && state.currentView !== 'friends') {
      var now = Date.now();
      if (now - lastTvBgSyncAt < 15000) return;
      lastTvBgSyncAt = now;
    }
    loadFriends();
    pollActiveDmChat();
  }
  setInterval(runBackgroundSyncTick, 1500);
  if (!state.tvMode) {
    try {
      var workerBlob = new Blob(['setInterval(function(){ postMessage("tick"); }, 2000);'], {
        type: 'application/javascript'
      });
      var bgWorker = new Worker(URL.createObjectURL(workerBlob));
      bgWorker.onmessage = () => {
        if (document.hidden && state.user) {
          runBackgroundSyncTick();
        }
      };
    } catch (_unused29) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user) {
      loadFriends();
      pollActiveDmChat();
    }
  });
  window.addEventListener('focus', () => {
    if (state.user) {
      loadFriends();
      pollActiveDmChat();
    }
  });
  function renderFriendsView() {
    var incBlock = $('incomingRequestsBlock');
    var incList = $('incomingRequestsList');
    if (state.incomingRequests.length > 0) {
      incBlock.classList.remove('hidden');
      incList.innerHTML = '';
      state.incomingRequests.forEach(req => {
        var row = document.createElement('div');
        row.className = 'user-row';
        row.innerHTML = `
          <div class="user-row-left" style="cursor:pointer;">
            <div class="avatar-circle" style="background:${esc(req.user.color)}">${avatarInnerHtml(req.user)}</div>
            <div>
              <div class="user-row-name">${esc(req.user.displayName)}</div>
              <div class="user-row-sub">@${esc(req.user.username)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="pill-btn tiny accent" data-accept="${esc(req.id)}">Принять</button>
            <button class="pill-btn tiny" data-decline="${esc(req.id)}">✕</button>
          </div>
        `;
        row.querySelector('.user-row-left').onclick = () => openUserCard(req.user.id);
        row.querySelector('[data-accept]').onclick = () => respondFriend(req.id, true);
        row.querySelector('[data-decline]').onclick = () => respondFriend(req.id, false);
        incList.appendChild(row);
      });
    } else {
      incBlock.classList.add('hidden');
    }
    var fList = $('friendsList');
    fList.innerHTML = '';
    if (state.friends.length === 0) {
      fList.innerHTML = '<div style="color:var(--text-muted);padding:16px 0;">У вас пока нет друзей. Найдите друга по логину выше!</div>';
      return;
    }
    state.friends.forEach(f => {
      var _state$user5, _f$lastMessage;
      var row = document.createElement('div');
      row.className = `user-row ${activeDmFriendId === f.id ? 'active-dm' : ''}`;
      row.style.cursor = 'pointer';
      var isFriendTyping = dmTypingUsers.has(f.id);
      var roomStatus = f.currentRoom ? `🍿 Смотрит: ${f.currentRoom.mediaTitle}` : f.lastMessage ? `${f.lastMessage.fromId === ((_state$user5 = state.user) === null || _state$user5 === void 0 ? void 0 : _state$user5.id) ? 'Вы: ' : ''}${f.lastMessage.text}` : f.online ? 'В сети' : 'Не в сети';
      var subHtml = isFriendTyping ? `<span class="dm-typing-status"><span>печатает</span>${renderTypingDotsHtml()}</span>` : esc(roomStatus);
      var lastTimeLabel = (_f$lastMessage = f.lastMessage) !== null && _f$lastMessage !== void 0 && _f$lastMessage.createdAt ? formatDialogListTime(f.lastMessage.createdAt) : '';
      row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${avatarInnerHtml(f)}</div>
          <div style="min-width:0;">
            <div class="user-row-name">${esc(f.displayName)}</div>
            <div class="user-row-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${subHtml}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${f.currentRoom ? `<button class="pill-btn tiny accent" data-join-friend="${esc(f.currentRoom.code)}" title="Войти в комнату друга">▶️</button>` : ''}
          ${f.unreadCount > 0 ? `<span class="nav-badge inline-badge">${f.unreadCount}</span>` : ''}
          ${lastTimeLabel ? `<span class="dialog-time-label">${esc(lastTimeLabel)}</span>` : ''}
        </div>
      `;
      row.addEventListener('click', e => {
        if (e.target.closest('[data-join-friend]')) return;
        openFriendChat(f.id);
      });
      var joinBtn = row.querySelector('[data-join-friend]');
      if (joinBtn) joinBtn.onclick = e => {
        e.stopPropagation();
        joinRoomByCode(f.currentRoom.code);
      };
      fList.appendChild(row);
    });
  }
  function updateDmHeader(friend) {
    setAvatarElement($('dmFriendAvatar'), friend, '🦊');
    $('dmFriendName').textContent = friend.displayName;
    if ($('dmFriendStatus')) {
      if (dmTypingUsers.has(friend.id)) {
        $('dmFriendStatus').innerHTML = `<span class="dm-typing-status"><span>печатает</span>${renderTypingDotsHtml()}</span>`;
      } else if (friend.currentRoom) {
        $('dmFriendStatus').innerHTML = `<span class="dm-status-dot online"></span><span>Смотрит: ${esc(friend.currentRoom.mediaTitle)}</span>`;
      } else if (friend.online) {
        $('dmFriendStatus').innerHTML = '<span class="dm-status-dot online"></span><span>В сети</span>';
      } else {
        $('dmFriendStatus').innerHTML = '<span class="dm-status-dot"></span><span>Не в сети</span>';
      }
    }
    $('dmFriendHeaderMeta').onclick = () => openUserCard(friend.id);
    var joinBtn = $('dmJoinRoomBtn');
    if (friend.currentRoom) {
      joinBtn.classList.remove('hidden');
      joinBtn.onclick = () => joinRoomByCode(friend.currentRoom.code);
    } else {
      joinBtn.classList.add('hidden');
    }
    var invBtn = $('dmInviteRoomBtn');
    if (state.room) {
      invBtn.classList.remove('hidden');
      invBtn.onclick = () => inviteFriendToCurrentRoom(friend.id);
    } else {
      invBtn.classList.add('hidden');
    }
  }
  function openFriendChat(_x27) {
    return _openFriendChat.apply(this, arguments);
  }
  function _openFriendChat() {
    _openFriendChat = _asyncToGenerator(_regenerator().m(function _callee43(friendId) {
      var _$115, _$116, _$117;
      var localFriend, box, _data2, msgs, _t42;
      return _regenerator().w(function (_context45) {
        while (1) switch (_context45.p = _context45.n) {
          case 0:
            activeDmFriendId = friendId;
            (_$115 = $('friendsLayout')) === null || _$115 === void 0 || _$115.classList.add('chat-open');
            document.body.classList.add('in-friends-chat');
            (_$116 = $('dmEmptyPrompt')) === null || _$116 === void 0 || _$116.classList.add('hidden');
            (_$117 = $('dmActiveBox')) === null || _$117 === void 0 || _$117.classList.remove('hidden');
            localFriend = state.friends.find(x => x.id === friendId);
            if (localFriend) {
              localFriend.unreadCount = 0;
              updateDmHeader(localFriend);
            }
            updateDmBadges();
            renderFriendsView();
            box = $('dmMessages');
            box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Загрузка переписки...</div>';
            _context45.p = 1;
            _context45.n = 2;
            return api(`/api/dms/${encodeURIComponent(friendId)}`);
          case 2:
            _data2 = _context45.v;
            if (_data2.friend) updateDmHeader(_data2.friend);
            box.innerHTML = '';
            msgs = _data2.messages || [];
            if (msgs.length === 0) {
              box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:0.84rem;">Сообщений пока нет. Напишите привет или отправьте фото! 👋📷</div>';
            } else {
              msgs.forEach(m => {
                if (m.id) notifiedDmIds.add(m.id);
                box.appendChild(createRichMessageElement(m, 'dm', 'dm', friendId));
              });
              refreshMessageGrouping(box);
              box.scrollTop = box.scrollHeight;
            }
            focusChatInput('dmInput');
            _context45.n = 4;
            break;
          case 3:
            _context45.p = 3;
            _t42 = _context45.v;
            box.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">${esc(_t42.message)}</div>`;
          case 4:
            return _context45.a(2);
        }
      }, _callee43, null, [[1, 3]]);
    }));
    return _openFriendChat.apply(this, arguments);
  }
  (_$92 = $('dmBackBtn')) === null || _$92 === void 0 || _$92.addEventListener('click', () => {
    var _$93;
    (_$93 = $('friendsLayout')) === null || _$93 === void 0 || _$93.classList.remove('chat-open');
    document.body.classList.remove('in-friends-chat');
  });
  function submitDirectMessageForm(_x28, _x29, _x30) {
    return _submitDirectMessageForm.apply(this, arguments);
  }
  function _submitDirectMessageForm() {
    _submitDirectMessageForm = _asyncToGenerator(_regenerator().m(function _callee44(friendId, inputId, composerKey) {
      var input, text, comp, editId, res, payload, _res4, _t43, _t44;
      return _regenerator().w(function (_context46) {
        while (1) switch (_context46.p = _context46.n) {
          case 0:
            if (friendId) {
              _context46.n = 1;
              break;
            }
            return _context46.a(2);
          case 1:
            input = $(inputId);
            text = getChatInputValue(input);
            comp = composers[composerKey];
            if (!(comp && comp.editingMsg)) {
              _context46.n = 7;
              break;
            }
            editId = comp.editingMsg.id;
            clearChatInput(input);
            comp.editingMsg = null;
            renderComposerBar(composerKey);
            if (text) {
              _context46.n = 2;
              break;
            }
            return _context46.a(2);
          case 2:
            if (!socket.connected) {
              _context46.n = 3;
              break;
            }
            socket.emit('dm:edit', {
              friendId,
              messageId: editId,
              text
            });
            _context46.n = 6;
            break;
          case 3:
            _context46.p = 3;
            _context46.n = 4;
            return api(`/api/dms/${encodeURIComponent(friendId)}/${encodeURIComponent(editId)}`, {
              method: 'PUT',
              body: JSON.stringify({
                text
              })
            });
          case 4:
            res = _context46.v;
            if (res.message) updateChatMessageDom(res.message, 'dm');
            _context46.n = 6;
            break;
          case 5:
            _context46.p = 5;
            _t43 = _context46.v;
            showToast(_t43.message);
          case 6:
            return _context46.a(2);
          case 7:
            if (!(!text && (!comp || !comp.imageUrl))) {
              _context46.n = 8;
              break;
            }
            return _context46.a(2);
          case 8:
            payload = {
              toId: friendId,
              text,
              imageUrl: (comp === null || comp === void 0 ? void 0 : comp.imageUrl) || '',
              viewOnce: !!(comp !== null && comp !== void 0 && comp.viewOnce),
              replyTo: (comp === null || comp === void 0 ? void 0 : comp.replyTo) || null
            };
            clearChatInput(input);
            emitLocalTyping('dm', friendId, false);
            focusChatInput(input);
            if (comp) {
              comp.imageUrl = '';
              comp.viewOnce = false;
              comp.replyTo = null;
              renderComposerBar(composerKey);
            }
            _context46.p = 9;
            _context46.n = 10;
            return api(`/api/dms/${encodeURIComponent(friendId)}`, {
              method: 'POST',
              body: JSON.stringify(payload)
            });
          case 10:
            _res4 = _context46.v;
            if (_res4.message) handleIncomingOrOutgoingDm(_res4.message);
            _context46.n = 12;
            break;
          case 11:
            _context46.p = 11;
            _t44 = _context46.v;
            showToast(_t44.message);
          case 12:
            return _context46.a(2);
        }
      }, _callee44, null, [[9, 11], [3, 5]]);
    }));
    return _submitDirectMessageForm.apply(this, arguments);
  }
  attachChatInputHandlers('dmInput', 'dmSendBtn', () => {
    submitDirectMessageForm(activeDmFriendId, 'dmInput', 'dm');
  });
  (_$94 = $('dmInput')) === null || _$94 === void 0 || _$94.addEventListener('input', e => {
    if (!activeDmFriendId) return;
    var val = (e.target.value || '').trim();
    emitLocalTyping('dm', activeDmFriendId, val.length > 0);
  });
  function renderRoomDmFriendsList() {
    var container = $('roomDmFriendsList');
    if (!container) return;
    container.innerHTML = '';
    if (!state.friends.length) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:16px;font-size:0.84rem;text-align:center;">Добавьте друзей во вкладке «Друзья», чтобы переписываться с ними прямо во время просмотра.</div>';
      return;
    }
    state.friends.forEach(f => {
      var _state$user6, _f$lastMessage2;
      var row = document.createElement('div');
      row.className = 'user-row';
      row.style.cursor = 'pointer';
      var isFriendTyping = dmTypingUsers.has(f.id);
      var sub = f.lastMessage ? `${f.lastMessage.fromId === ((_state$user6 = state.user) === null || _state$user6 === void 0 ? void 0 : _state$user6.id) ? 'Вы: ' : ''}${f.lastMessage.text}` : f.online ? '🟢 В сети' : '⚪ Не в сети';
      var subHtml = isFriendTyping ? `<span class="dm-typing-status"><span>печатает</span>${renderTypingDotsHtml()}</span>` : esc(sub);
      var lastTimeLabel = (_f$lastMessage2 = f.lastMessage) !== null && _f$lastMessage2 !== void 0 && _f$lastMessage2.createdAt ? formatDialogListTime(f.lastMessage.createdAt) : '';
      row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${avatarInnerHtml(f)}</div>
          <div style="min-width:0;">
            <div class="user-row-name">${esc(f.displayName)}</div>
            <div class="user-row-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;">${subHtml}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${f.unreadCount > 0 ? `<span class="nav-badge inline-badge">${f.unreadCount}</span>` : ''}
          ${lastTimeLabel ? `<span class="dialog-time-label">${esc(lastTimeLabel)}</span>` : ''}
        </div>
      `;
      row.onclick = () => openRoomDmChat(f.id);
      container.appendChild(row);
    });
  }
  function openRoomDmChat(_x31) {
    return _openRoomDmChat.apply(this, arguments);
  }
  function _openRoomDmChat() {
    _openRoomDmChat = _asyncToGenerator(_regenerator().m(function _callee45(friendId) {
      var _$118, _$119;
      var f, box, _data3, _t45;
      return _regenerator().w(function (_context47) {
        while (1) switch (_context47.p = _context47.n) {
          case 0:
            roomActiveDmFriendId = friendId;
            (_$118 = $('roomDmFriendsView')) === null || _$118 === void 0 || _$118.classList.add('hidden');
            (_$119 = $('roomDmChatView')) === null || _$119 === void 0 || _$119.classList.remove('hidden');
            f = state.friends.find(x => x.id === friendId);
            if (f) {
              f.unreadCount = 0;
              setAvatarElement($('roomDmFriendAvatar'), f, '🦊');
              $('roomDmFriendName').textContent = f.displayName;
              $('roomDmInviteBtn').onclick = () => inviteFriendToCurrentRoom(f.id);
            }
            updateDmBadges();
            renderRoomDmFriendsList();
            box = $('roomDmMessages');
            box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:0.82rem;">Загрузка...</div>';
            _context47.p = 1;
            _context47.n = 2;
            return api(`/api/dms/${encodeURIComponent(friendId)}`);
          case 2:
            _data3 = _context47.v;
            box.innerHTML = '';
            (_data3.messages || []).forEach(m => {
              if (m.id) notifiedDmIds.add(m.id);
              box.appendChild(createRichMessageElement(m, 'dm', 'roomDm', friendId));
            });
            refreshMessageGrouping(box);
            box.scrollTop = box.scrollHeight;
            focusChatInput('roomDmInput');
            _context47.n = 4;
            break;
          case 3:
            _context47.p = 3;
            _t45 = _context47.v;
          case 4:
            return _context47.a(2);
        }
      }, _callee45, null, [[1, 3]]);
    }));
    return _openRoomDmChat.apply(this, arguments);
  }
  (_$95 = $('roomDmBackBtn')) === null || _$95 === void 0 || _$95.addEventListener('click', () => {
    var _$96, _$97;
    roomActiveDmFriendId = null;
    (_$96 = $('roomDmChatView')) === null || _$96 === void 0 || _$96.classList.add('hidden');
    (_$97 = $('roomDmFriendsView')) === null || _$97 === void 0 || _$97.classList.remove('hidden');
    renderRoomDmFriendsList();
  });
  attachChatInputHandlers('roomDmInput', 'roomDmSendBtn', () => {
    submitDirectMessageForm(roomActiveDmFriendId, 'roomDmInput', 'roomDm');
  });
  (_$98 = $('roomDmInput')) === null || _$98 === void 0 || _$98.addEventListener('input', e => {
    if (!roomActiveDmFriendId) return;
    var val = (e.target.value || '').trim();
    emitLocalTyping('dm', roomActiveDmFriendId, val.length > 0);
  });
  function handleIncomingOrOutgoingDm(msg) {
    var _$99;
    if (!state.user) return;
    var otherId = msg.fromId === state.user.id ? msg.toId : msg.fromId;
    if (msg.fromId !== state.user.id && dmTypingUsers.has(otherId)) {
      var t = dmTypingUsers.get(otherId);
      if (t !== null && t !== void 0 && t.timer) clearTimeout(t.timer);
      dmTypingUsers.delete(otherId);
      updateChatBoxTypingBubble('dmMessages', []);
      updateChatBoxTypingBubble('roomDmMessages', []);
    }
    var friend = state.friends.find(x => x.id === otherId);
    var previewText = msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : msg.hasPhoto || msg.hasImage || msg.imageUrl ? '📷 Фотография' : '');
    if (friend) {
      friend.lastMessage = {
        id: msg.id,
        text: previewText,
        fromId: msg.fromId,
        createdAt: msg.createdAt
      };
    }
    var isViewingInFriendsPage = state.currentView === 'friends' && activeDmFriendId === otherId;
    var isViewingInRoomSidebar = state.currentView === 'room' && roomActiveDmFriendId === otherId && !((_$99 = $('roomDmChatView')) !== null && _$99 !== void 0 && _$99.classList.contains('hidden'));
    if (activeDmFriendId === otherId) {
      var box = $('dmMessages');
      if (box && !box.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) {
        if (box.querySelector('div[style*="text-align:center"]')) box.innerHTML = '';
        box.appendChild(createRichMessageElement(msg, 'dm', 'dm', otherId));
        refreshMessageGrouping(box);
        box.scrollTop = box.scrollHeight;
      }
    }
    if (roomActiveDmFriendId === otherId) {
      var rBox = $('roomDmMessages');
      if (rBox && !rBox.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) {
        rBox.appendChild(createRichMessageElement(msg, 'dm', 'roomDm', otherId));
        refreshMessageGrouping(rBox);
        rBox.scrollTop = rBox.scrollHeight;
      }
    }
    if (msg.fromId !== state.user.id) {
      if ((isViewingInFriendsPage || isViewingInRoomSidebar) && !document.hidden) {
        socket.emit('dm:read', {
          friendId: otherId
        });
      } else if (friend) {
        friend.unreadCount = (friend.unreadCount || 0) + 1;
      }
      if (!notifiedDmIds.has(msg.id)) {
        var _msg$sender2;
        markDmNotified(msg.id);
        triggerAppNotification({
          title: ((_msg$sender2 = msg.sender) === null || _msg$sender2 === void 0 ? void 0 : _msg$sender2.displayName) || (friend === null || friend === void 0 ? void 0 : friend.displayName) || 'Друг',
          body: previewText,
          user: msg.sender || friend,
          data: {
            friendId: otherId,
            tag: 'dm-msg-' + msg.id
          },
          onClick: () => {
            if (state.currentView === 'room') {
              setMobileRoomTab('dms');
              openRoomDmChat(otherId);
            } else {
              switchView('friends');
              openFriendChat(otherId);
            }
          }
        });
      }
    }
    updateDmBadges();
    renderFriendsView();
    renderRoomDmFriendsList();
  }
  socket.on('dm:message', handleIncomingOrOutgoingDm);
  socket.on('dm:updated', msg => {
    updateChatMessageDom(msg, 'dm');
  });
  socket.on('dm:deleted', ({
    id
  }) => {
    removeChatMessageDom(id);
  });
  socket.on('dm:read_ack', ({
    readerId
  }) => {
    if (!readerId) return;
    ['dmMessages', 'roomDmMessages'].forEach(boxId => {
      var box = $(boxId);
      if (!box) return;
      var isTarget = boxId === 'dmMessages' && activeDmFriendId === readerId || boxId === 'roomDmMessages' && roomActiveDmFriendId === readerId;
      if (!isTarget) return;
      box.querySelectorAll('.chat-msg.own .chat-ticks:not(.read)').forEach(t => {
        t.outerHTML = renderTickIcon(true);
      });
    });
  });
  setInterval(() => {
    ['chatMessages', 'dmMessages', 'roomDmMessages'].forEach(id => {
      var box = $(id);
      if (box && box.children.length > 0) refreshMessageGrouping(box);
    });
  }, 60000);
  function respondFriend(_x32, _x33) {
    return _respondFriend.apply(this, arguments);
  }
  function _respondFriend() {
    _respondFriend = _asyncToGenerator(_regenerator().m(function _callee46(requestId, accept) {
      var _t46;
      return _regenerator().w(function (_context48) {
        while (1) switch (_context48.p = _context48.n) {
          case 0:
            _context48.p = 0;
            _context48.n = 1;
            return api('/api/friends/respond', {
              method: 'POST',
              body: JSON.stringify({
                requestId,
                accept
              })
            });
          case 1:
            loadFriends();
            _context48.n = 3;
            break;
          case 2:
            _context48.p = 2;
            _t46 = _context48.v;
            showToast(_t46.message);
          case 3:
            return _context48.a(2);
        }
      }, _callee46, null, [[0, 2]]);
    }));
    return _respondFriend.apply(this, arguments);
  }
  $('friendSearchBtn').addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee12() {
    var q, _data$users, data, box, _t0;
    return _regenerator().w(function (_context12) {
      while (1) switch (_context12.p = _context12.n) {
        case 0:
          _context12.n = 1;
          return ensureAuthenticated();
        case 1:
          if (_context12.v) {
            _context12.n = 2;
            break;
          }
          return _context12.a(2);
        case 2:
          q = $('friendSearchInput').value.trim();
          if (q) {
            _context12.n = 3;
            break;
          }
          return _context12.a(2);
        case 3:
          _context12.p = 3;
          _context12.n = 4;
          return api(`/api/users/search?q=${encodeURIComponent(q)}`);
        case 4:
          data = _context12.v;
          box = $('friendSearchResults');
          box.classList.remove('hidden');
          box.innerHTML = '';
          if ((_data$users = data.users) !== null && _data$users !== void 0 && _data$users.length) {
            _context12.n = 5;
            break;
          }
          box.innerHTML = '<div style="color:var(--text-muted);padding:8px 0;">Пользователи не найдены</div>';
          return _context12.a(2);
        case 5:
          data.users.forEach(u => {
            var row = document.createElement('div');
            row.className = 'user-row';
            row.innerHTML = `
          <div class="user-row-left" style="cursor:pointer;">
            <div class="avatar-circle" style="background:${esc(u.color)}">${avatarInnerHtml(u)}</div>
            <div>
              <div class="user-row-name">${esc(u.displayName)}</div>
              <div class="user-row-sub">@${esc(u.username)}</div>
            </div>
          </div>
          <button class="pill-btn tiny accent">+ Добавить</button>
        `;
            row.querySelector('.user-row-left').onclick = () => openUserCard(u.id);
            row.querySelector('button').onclick = _asyncToGenerator(_regenerator().m(function _callee11() {
              var _t9;
              return _regenerator().w(function (_context11) {
                while (1) switch (_context11.p = _context11.n) {
                  case 0:
                    _context11.p = 0;
                    _context11.n = 1;
                    return api('/api/friends/request', {
                      method: 'POST',
                      body: JSON.stringify({
                        target: u.id
                      })
                    });
                  case 1:
                    showToast(`Заявка отправлена ${u.displayName}`);
                    box.classList.add('hidden');
                    loadFriends();
                    _context11.n = 3;
                    break;
                  case 2:
                    _context11.p = 2;
                    _t9 = _context11.v;
                    showToast(_t9.message);
                  case 3:
                    return _context11.a(2);
                }
              }, _callee11, null, [[0, 2]]);
            }));
            box.appendChild(row);
          });
          _context12.n = 7;
          break;
        case 6:
          _context12.p = 6;
          _t0 = _context12.v;
          showToast(_t0.message);
        case 7:
          return _context12.a(2);
      }
    }, _callee12, null, [[3, 6]]);
  })));
  $('inviteFriendsModalBtn').addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee13() {
    var shareUrl, list;
    return _regenerator().w(function (_context13) {
      while (1) switch (_context13.n) {
        case 0:
          if (state.room) {
            _context13.n = 1;
            break;
          }
          return _context13.a(2);
        case 1:
          shareUrl = `${window.location.origin}/?room=${state.room.code}`;
          $('inviteShareUrl').value = shareUrl;
          $('inviteModal').classList.remove('hidden');
          _context13.n = 2;
          return loadFriends();
        case 2:
          list = $('inviteFriendsList');
          list.innerHTML = '';
          if (state.friends.length) {
            _context13.n = 3;
            break;
          }
          list.innerHTML = '<div style="color:var(--text-muted);font-size:0.84rem;">Скопируйте ссылку выше и отправьте друзьям!</div>';
          return _context13.a(2);
        case 3:
          state.friends.forEach(f => {
            var row = document.createElement('div');
            row.className = 'user-row';
            row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${avatarInnerHtml(f)}</div>
          <div class="user-row-name">${esc(f.displayName)}</div>
        </div>
        <button class="pill-btn tiny accent">Пригласить</button>
      `;
            row.querySelector('button').onclick = () => {
              inviteFriendToCurrentRoom(f.id);
            };
            list.appendChild(row);
          });
        case 4:
          return _context13.a(2);
      }
    }, _callee13);
  })));
  $('copyShareUrlBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('inviteShareUrl').value).then(() => {
      showToast('Ссылка скопирована!');
    });
  });
  var rtcConfig = {
    iceServers: [{
      urls: 'stun:stun.l.google.com:19302'
    }]
  };
  function toggleVoiceChat() {
    return _toggleVoiceChat.apply(this, arguments);
  }
  function _toggleVoiceChat() {
    _toggleVoiceChat = _asyncToGenerator(_regenerator().m(function _callee47() {
      var _t47;
      return _regenerator().w(function (_context49) {
        while (1) switch (_context49.p = _context49.n) {
          case 0:
            if (state.room) {
              _context49.n = 1;
              break;
            }
            return _context49.a(2);
          case 1:
            if (!state.voiceActive) {
              _context49.n = 2;
              break;
            }
            stopVoiceChat();
            showToast('Голосовой чат выключен');
            return _context49.a(2);
          case 2:
            _context49.p = 2;
            _context49.n = 3;
            return navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false
            });
          case 3:
            state.localStream = _context49.v;
            state.voiceActive = true;
            updateVoiceSettingsUi();
            socket.emit('voice:toggle', {
              active: true,
              muted: false
            });
            showToast('🎙️ Вы подключились к голосовому чату');
            _context49.n = 5;
            break;
          case 4:
            _context49.p = 4;
            _t47 = _context49.v;
            showToast('Нет доступа к микрофону');
          case 5:
            return _context49.a(2);
        }
      }, _callee47, null, [[2, 4]]);
    }));
    return _toggleVoiceChat.apply(this, arguments);
  }
  function stopVoiceChat() {
    state.voiceActive = false;
    updateVoiceSettingsUi();
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
    }
    var _iterator3 = _createForOfIteratorHelper(state.peers.values()),
      _step3;
    try {
      for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
        var pc = _step3.value;
        try {
          pc.close();
        } catch (_unused30) {}
      }
    } catch (err) {
      _iterator3.e(err);
    } finally {
      _iterator3.f();
    }
    state.peers.clear();
    $('remoteAudioContainer').innerHTML = '';
    if (state.room) {
      socket.emit('voice:toggle', {
        active: false,
        muted: false
      });
    }
  }
  $('voiceToggleBtn').addEventListener('click', toggleVoiceChat);
  function createPeerConnection(peerSocketId, initiator) {
    if (state.peers.has(peerSocketId)) return state.peers.get(peerSocketId);
    var pc = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerSocketId, pc);
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
    }
    pc.onicecandidate = e => {
      if (e.candidate) {
        socket.emit('voice:signal', {
          toSocketId: peerSocketId,
          data: {
            candidate: e.candidate
          }
        });
      }
    };
    pc.ontrack = e => {
      var audio = document.getElementById(`audio_${peerSocketId}`);
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio_${peerSocketId}`;
        audio.autoplay = true;
        $('remoteAudioContainer').appendChild(audio);
      }
      audio.srcObject = e.streams[0];
    };
    if (initiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('voice:signal', {
          toSocketId: peerSocketId,
          data: {
            sdp: offer
          }
        });
      });
    }
    return pc;
  }
  socket.on('voice:peer_joined', ({
    socketId
  }) => {
    if (!state.voiceActive) return;
    createPeerConnection(socketId, true);
  });
  socket.on('voice:signal', function () {
    var _ref16 = _asyncToGenerator(_regenerator().m(function _callee14({
      fromSocketId,
      data
    }) {
      var pc, answer, _t1;
      return _regenerator().w(function (_context14) {
        while (1) switch (_context14.p = _context14.n) {
          case 0:
            if (state.voiceActive) {
              _context14.n = 1;
              break;
            }
            return _context14.a(2);
          case 1:
            pc = createPeerConnection(fromSocketId, false);
            if (!data.sdp) {
              _context14.n = 6;
              break;
            }
            _context14.n = 2;
            return pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          case 2:
            if (!(data.sdp.type === 'offer')) {
              _context14.n = 5;
              break;
            }
            _context14.n = 3;
            return pc.createAnswer();
          case 3:
            answer = _context14.v;
            _context14.n = 4;
            return pc.setLocalDescription(answer);
          case 4:
            socket.emit('voice:signal', {
              toSocketId: fromSocketId,
              data: {
                sdp: answer
              }
            });
          case 5:
            _context14.n = 10;
            break;
          case 6:
            if (!data.candidate) {
              _context14.n = 10;
              break;
            }
            _context14.p = 7;
            _context14.n = 8;
            return pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          case 8:
            _context14.n = 10;
            break;
          case 9:
            _context14.p = 9;
            _t1 = _context14.v;
          case 10:
            return _context14.a(2);
        }
      }, _callee14, null, [[7, 9]]);
    }));
    return function (_x34) {
      return _ref16.apply(this, arguments);
    };
  }());
  socket.on('voice:peer_left', ({
    socketId
  }) => {
    var pc = state.peers.get(socketId);
    if (pc) {
      try {
        pc.close();
      } catch (_unused32) {}
      state.peers.delete(socketId);
    }
    var audio = document.getElementById(`audio_${socketId}`);
    if (audio) audio.remove();
  });
  function renderRoomQueue(queue = []) {
    var countEl = $('roomQueueCount');
    var listEl = $('roomQueueList');
    if (countEl) countEl.textContent = queue.length;
    if (!listEl) return;
    if (!queue.length) {
      listEl.innerHTML = '<div class="queue-empty-state">Очередь пуста — добавьте фильмы из каталога</div>';
      return;
    }
    listEl.innerHTML = '';
    queue.forEach(item => {
      var _item$addedBy;
      var m = item.movie || {};
      var votes = Array.isArray(item.votes) ? item.votes : [];
      var hasVoted = state.user && votes.includes(state.user.id);
      var row = document.createElement('div');
      row.className = 'queue-item-row';
      row.innerHTML = `
        <img class="queue-item-poster" src="${esc(m.poster || m.backdrop || '')}" alt="" />
        <div class="queue-item-info">
          <div class="queue-item-title">${esc(m.title || 'Фильм')}</div>
          <div class="queue-item-meta">${esc(m.year || '')}${(_item$addedBy = item.addedBy) !== null && _item$addedBy !== void 0 && _item$addedBy.displayName ? ` · от ${esc(item.addedBy.displayName)}` : ''}</div>
        </div>
        <div class="queue-item-actions">
          <button type="button" class="queue-vote-btn ${hasVoted ? 'voted' : ''}" title="Голосовать">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            <span>${votes.length}</span>
          </button>
          <button type="button" class="pill-btn tiny accent queue-play-btn" title="Включить сейчас">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          </button>
          <button type="button" class="pill-btn tiny queue-del-btn" title="Удалить">✕</button>
        </div>
      `;
      row.querySelector('.queue-vote-btn').onclick = () => {
        socket.emit('room:queue_vote', {
          itemId: item.id
        });
      };
      row.querySelector('.queue-play-btn').onclick = _asyncToGenerator(_regenerator().m(function _callee15() {
        return _regenerator().w(function (_context15) {
          while (1) switch (_context15.n) {
            case 0:
              socket.emit('room:queue_remove', {
                itemId: item.id
              });
              _context15.n = 1;
              return loadZ01ForMovieInRoom(m, true);
            case 1:
              return _context15.a(2);
          }
        }, _callee15);
      }));
      row.querySelector('.queue-del-btn').onclick = () => {
        socket.emit('room:queue_remove', {
          itemId: item.id
        });
      };
      listEl.appendChild(row);
    });
  }
  (_$100 = $('addQueueFromCatalogBtn')) === null || _$100 === void 0 || _$100.addEventListener('click', () => {
    switchView('explore');
    showToast('Выберите фильм в каталоге и нажмите «В очередь комнаты»');
  });
  var nextEpDismissedForVideo = '';
  function getNextPlayableCandidate() {
    var _state$z3, _state$z4, _state$z5, _state$room1;
    var videos = ((_state$z3 = state.z01) === null || _state$z3 === void 0 ? void 0 : _state$z3.videos) || [];
    var curIdx = ((_state$z4 = state.z01) === null || _state$z4 === void 0 ? void 0 : _state$z4.activeVideoIdx) || 0;
    var isSeries = videos.length > 1 && (((_state$z5 = state.z01) === null || _state$z5 === void 0 || (_state$z5 = _state$z5.seasons) === null || _state$z5 === void 0 ? void 0 : _state$z5.length) > 0 || videos.some(v => v.episode > 0));
    if (isSeries && curIdx + 1 < videos.length) {
      var nextVid = videos[curIdx + 1];
      var epNum = nextVid.episode || curIdx + 2;
      return {
        type: 'episode',
        index: curIdx + 1,
        label: `След. серия (${epNum})`
      };
    }
    var q = ((_state$room1 = state.room) === null || _state$room1 === void 0 ? void 0 : _state$room1.queue) || [];
    if (q.length > 0 && q[0].movie) {
      return {
        type: 'queue',
        item: q[0],
        label: `Далее: «${q[0].movie.title}»`
      };
    }
    return null;
  }
  function triggerNextPlayable() {
    return _triggerNextPlayable.apply(this, arguments);
  }
  function _triggerNextPlayable() {
    _triggerNextPlayable = _asyncToGenerator(_regenerator().m(function _callee48() {
      var _$120;
      var cand;
      return _regenerator().w(function (_context50) {
        while (1) switch (_context50.n) {
          case 0:
            (_$120 = $('nextEpisodePrompt')) === null || _$120 === void 0 || _$120.classList.add('hidden');
            cand = getNextPlayableCandidate();
            if (cand) {
              _context50.n = 1;
              break;
            }
            return _context50.a(2);
          case 1:
            if (!(cand.type === 'episode')) {
              _context50.n = 2;
              break;
            }
            selectZ01VideoItem(cand.index, true);
            _context50.n = 3;
            break;
          case 2:
            if (!(cand.type === 'queue' && cand.item)) {
              _context50.n = 3;
              break;
            }
            socket.emit('room:queue_remove', {
              itemId: cand.item.id
            });
            _context50.n = 3;
            return loadZ01ForMovieInRoom(cand.item.movie, true);
          case 3:
            return _context50.a(2);
        }
      }, _callee48);
    }));
    return _triggerNextPlayable.apply(this, arguments);
  }
  (_$101 = $('skipIntroBtn')) === null || _$101 === void 0 || _$101.addEventListener('click', e => {
    var _$102;
    e.stopPropagation();
    seekTvRelative(85);
    (_$102 = $('skipIntroBtn')) === null || _$102 === void 0 || _$102.classList.add('hidden');
  });
  (_$103 = $('nextEpPlayNowBtn')) === null || _$103 === void 0 || _$103.addEventListener('click', e => {
    e.stopPropagation();
    triggerNextPlayable();
  });
  (_$104 = $('playNextEpNowBtn')) === null || _$104 === void 0 || _$104.addEventListener('click', e => {
    e.stopPropagation();
    triggerNextPlayable();
  });
  (_$105 = $('nextEpCancelBtn')) === null || _$105 === void 0 || _$105.addEventListener('click', e => {
    var _$106;
    e.stopPropagation();
    nextEpDismissedForVideo = state.loadedStreamKey || 'dismissed';
    (_$106 = $('nextEpisodePrompt')) === null || _$106 === void 0 || _$106.classList.add('hidden');
  });
  (_$107 = $('cancelNextEpBtn')) === null || _$107 === void 0 || _$107.addEventListener('click', e => {
    var _$108;
    e.stopPropagation();
    nextEpDismissedForVideo = state.loadedStreamKey || 'dismissed';
    (_$108 = $('nextEpisodePrompt')) === null || _$108 === void 0 || _$108.classList.add('hidden');
  });
  mainVideo.addEventListener('timeupdate', () => {
    var cur = mainVideo.currentTime || 0;
    var dur = mainVideo.duration && isFinite(mainVideo.duration) ? mainVideo.duration : 0;
    var nextPrompt = $('nextEpisodePrompt');
    if (nextPrompt) {
      var rem = dur - cur;
      var cand = dur > 120 && rem > 0.5 && rem <= 12 ? getNextPlayableCandidate() : null;
      if (cand && nextEpDismissedForVideo !== (state.loadedStreamKey || 'dismissed')) {
        nextPrompt.classList.remove('hidden');
        if ($('nextEpCountdownText')) {
          $('nextEpCountdownText').textContent = `${cand.label} через ${Math.ceil(rem)}с...`;
        }
      } else {
        nextPrompt.classList.add('hidden');
      }
    }
  });
  mainVideo.addEventListener('ended', () => {
    var cand = getNextPlayableCandidate();
    if (cand && nextEpDismissedForVideo !== (state.loadedStreamKey || 'dismissed')) {
      triggerNextPlayable();
    }
  });
  var ambientEnabled = localStorage.getItem('oulo_ambient_glow') !== 'false';
  function updateAmbientUi() {
    var wrapper = $('playerWrapper');
    var btn = $('toggleAmbientBtn');
    if (wrapper) wrapper.classList.toggle('ambient-active', ambientEnabled);
    if (btn) btn.classList.toggle('active', ambientEnabled);
  }
  updateAmbientUi();
  (_$109 = $('toggleAmbientBtn')) === null || _$109 === void 0 || _$109.addEventListener('click', () => {
    ambientEnabled = !ambientEnabled;
    localStorage.setItem('oulo_ambient_glow', ambientEnabled ? 'true' : 'false');
    updateAmbientUi();
    showToast(ambientEnabled ? 'Фоновая подсветка включена' : 'Фоновая подсветка выключена');
  });
  setInterval(() => {
    if (state.tvMode || !ambientEnabled || mainVideo.paused || mainVideo.ended || state.currentView !== 'room') return;
    var canvas = $('ambientGlowCanvas');
    if (!canvas) return;
    try {
      var ctx = canvas.getContext('2d');
      if (ctx && mainVideo.readyState >= 2) {
        ctx.drawImage(mainVideo, 0, 0, canvas.width, canvas.height);
      }
    } catch (_unused33) {}
  }, 260);
  (_$110 = $('togglePipBtn')) === null || _$110 === void 0 || _$110.addEventListener('click', _asyncToGenerator(_regenerator().m(function _callee16() {
    var _t10;
    return _regenerator().w(function (_context16) {
      while (1) switch (_context16.p = _context16.n) {
        case 0:
          _context16.p = 0;
          if (!document.pictureInPictureElement) {
            _context16.n = 2;
            break;
          }
          _context16.n = 1;
          return document.exitPictureInPicture();
        case 1:
          _context16.n = 5;
          break;
        case 2:
          if (!mainVideo.requestPictureInPicture) {
            _context16.n = 4;
            break;
          }
          _context16.n = 3;
          return mainVideo.requestPictureInPicture();
        case 3:
          _context16.n = 5;
          break;
        case 4:
          if (mainVideo.webkitSetPresentationMode) {
            mainVideo.webkitSetPresentationMode(mainVideo.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
          } else {
            showToast('Режим «Картинка в картинке» не поддерживается браузером');
          }
        case 5:
          _context16.n = 7;
          break;
        case 6:
          _context16.p = 6;
          _t10 = _context16.v;
          showToast('Запустите видео для включения «Картинки в картинке»');
        case 7:
          return _context16.a(2);
      }
    }, _callee16, null, [[0, 6]]);
  })));
  var lastPlayerTapTime = 0;
  var lastPlayerTapSide = '';
  (_$111 = $('playerWrapper')) === null || _$111 === void 0 || _$111.addEventListener('touchend', e => {
    var _e$changedTouches;
    if (e.target.closest('button, input, .tv-player-osd, .skip-intro-btn, .next-ep-prompt')) return;
    var touch = (_e$changedTouches = e.changedTouches) === null || _e$changedTouches === void 0 ? void 0 : _e$changedTouches[0];
    if (!touch) return;
    var rect = $('playerWrapper').getBoundingClientRect();
    var relX = (touch.clientX - rect.left) / Math.max(1, rect.width);
    var side = relX < 0.32 ? 'left' : relX > 0.68 ? 'right' : '';
    if (!side) return;
    var now = Date.now();
    if (now - lastPlayerTapTime < 310 && lastPlayerTapSide === side) {
      e.preventDefault();
      var delta = side === 'left' ? -10 : 10;
      seekTvRelative(delta);
      var ind = document.createElement('div');
      ind.className = `double-tap-indicator ${side}`;
      ind.textContent = side === 'left' ? '⏪ -10 сек' : '+10 сек ⏩';
      $('playerWrapper').appendChild(ind);
      setTimeout(() => ind.remove(), 550);
      lastPlayerTapTime = 0;
    } else {
      lastPlayerTapTime = now;
      lastPlayerTapSide = side;
    }
  }, {
    passive: false
  });
  var bufferingDebounceTimer = null;
  var isCurrentlyBuffering = false;
  var activeBufferingPeers = new Map();
  function renderBufferingBanner() {
    var banner = $('bufferingWaitBanner');
    var txt = $('bufferingWaitText');
    if (!banner || !txt) return;
    var names = Array.from(activeBufferingPeers.values());
    if (names.length === 0) {
      banner.classList.add('hidden');
    } else {
      txt.textContent = `Ждём подгрузку у ${names.join(', ')}...`;
      banner.classList.remove('hidden');
    }
  }
  mainVideo.addEventListener('waiting', () => {
    if (!state.room || mainVideo.paused) return;
    clearTimeout(bufferingDebounceTimer);
    bufferingDebounceTimer = setTimeout(() => {
      if (!mainVideo.paused && mainVideo.readyState < 3) {
        isCurrentlyBuffering = true;
        socket.emit('player:buffering', {
          buffering: true
        });
      }
    }, 1300);
  });
  var clearBufferingState = () => {
    clearTimeout(bufferingDebounceTimer);
    if (isCurrentlyBuffering) {
      isCurrentlyBuffering = false;
      if (state.room) socket.emit('player:buffering', {
        buffering: false
      });
    }
  };
  mainVideo.addEventListener('playing', clearBufferingState);
  mainVideo.addEventListener('canplay', clearBufferingState);
  mainVideo.addEventListener('pause', clearBufferingState);
  socket.on('player:buffering_state', ({
    userId,
    user,
    buffering
  }) => {
    if (!userId || state.user && userId === state.user.id) return;
    if (buffering && user) {
      activeBufferingPeers.set(userId, user.displayName || 'зрителя');
    } else {
      activeBufferingPeers.delete(userId);
    }
    renderBufferingBanner();
  });
  var activeVoiceSpeakers = new Map();
  var localVoiceSpeaking = false;
  function renderVoiceSpeakersOverlay() {
    var box = $('voiceSpeakersOverlay');
    if (!box) return;
    if (activeVoiceSpeakers.size === 0) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = Array.from(activeVoiceSpeakers.values()).map(u => `
      <div class="voice-speaker-pill">
        <span class="voice-speaker-av">${avatarInnerHtml(u)}</span>
        <span>${esc(u.displayName || 'Участник')}</span>
        <span class="voice-speaker-wave"></span>
      </div>
    `).join('');
  }
  socket.on('voice:speaking', ({
    userId,
    user,
    speaking
  }) => {
    if (!userId) return;
    if (speaking && user) {
      activeVoiceSpeakers.set(userId, user);
    } else {
      activeVoiceSpeakers.delete(userId);
    }
    renderVoiceSpeakersOverlay();
  });
  var localAnalyser = null;
  var localAnalyserStream = null;
  setInterval(() => {
    if (!state.voiceActive || !state.localStream || !state.room) {
      if (localVoiceSpeaking) {
        localVoiceSpeaking = false;
        if (state.user) activeVoiceSpeakers.delete(state.user.id);
        renderVoiceSpeakersOverlay();
        socket.emit('voice:speaking', {
          speaking: false
        });
      }
      return;
    }
    try {
      if (localAnalyserStream !== state.localStream) {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          var ctx = new AudioCtx();
          var src = ctx.createMediaStreamSource(state.localStream);
          localAnalyser = ctx.createAnalyser();
          localAnalyser.fftSize = 256;
          src.connect(localAnalyser);
          localAnalyserStream = state.localStream;
        }
      }
      if (localAnalyser) {
        var data = new Uint8Array(localAnalyser.frequencyBinCount);
        localAnalyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var avg = sum / data.length;
        var nowSpeaking = avg > 16;
        if (nowSpeaking !== localVoiceSpeaking) {
          localVoiceSpeaking = nowSpeaking;
          if (state.user) {
            if (nowSpeaking) activeVoiceSpeakers.set(state.user.id, state.user);else activeVoiceSpeakers.delete(state.user.id);
            renderVoiceSpeakersOverlay();
          }
          socket.emit('voice:speaking', {
            speaking: nowSpeaking
          });
        }
      }
    } catch (_unused35) {}
  }, 240);
  function boot() {
    return _boot.apply(this, arguments);
  }
  function _boot() {
    _boot = _asyncToGenerator(_regenerator().m(function _callee49() {
      var notice, params, dmFriendId, targetView, roomCode, cleanUrl, _cleanUrl;
      return _regenerator().w(function (_context51) {
        while (1) switch (_context51.n) {
          case 0:
            try {
              notice = sessionStorage.getItem('eviction_notice');
              if (notice) {
                sessionStorage.removeItem('eviction_notice');
                setTimeout(() => showToast(notice), 300);
              }
            } catch (_unused54) {}
            updateNotificationBellUi();
            loadCatalog(true);
            loadPublicRooms();
            _context51.n = 1;
            return initAuth();
          case 1:
            updateNotificationBellUi();
            if (state.tvMode) {
              setSmartTvMode(true);
              setTimeout(() => {
                var first = document.querySelector('#catalogGrid .poster-card, #heroWatchPartyBtn');
                if (first && (!document.activeElement || document.activeElement === document.body)) first.focus();
              }, 1200);
            }
            params = new URLSearchParams(window.location.search);
            dmFriendId = params.get('dm');
            targetView = params.get('view');
            roomCode = params.get('room');
            if (!(dmFriendId && state.user)) {
              _context51.n = 3;
              break;
            }
            cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('dm');
            window.history.replaceState({}, '', cleanUrl.toString());
            switchView('friends');
            _context51.n = 2;
            return loadFriends();
          case 2:
            openFriendChat(dmFriendId);
            return _context51.a(2);
          case 3:
            if (targetView && state.user) {
              _cleanUrl = new URL(window.location.href);
              _cleanUrl.searchParams.delete('view');
              window.history.replaceState({}, '', _cleanUrl.toString());
              switchView(targetView);
            }
            if (!roomCode) {
              try {
                roomCode = sessionStorage.getItem('active_room_code');
              } catch (_unused55) {}
            }
            if (roomCode) {
              if (!state.user) {
                try {
                  sessionStorage.setItem('active_room_code', roomCode);
                } catch (_unused56) {}
                openAuthModal();
                showToast('Для входа в комнату войдите или зарегистрируйтесь');
              } else {
                joinRoomByCode(roomCode);
              }
            }
          case 4:
            return _context51.a(2);
        }
      }, _callee49);
    }));
    return _boot.apply(this, arguments);
  }
  boot();
})();
