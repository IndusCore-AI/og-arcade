I wrote `rate.ts` with a **12-line** `TokenBucket` class that refills tokens over time, up to a fixed capacity. Calling `tryRemove(n)` takes `n` tokens and returns `true`, or returns `false` if too few are left.

Two things to know:

- The bucket starts full, so the first burst always goes through.
- Refill is computed lazily on each call, so an idle bucket costs nothing.

```ts
const b = new TokenBucket(5, 1)
b.tryRemove() // true
```

Next, I can add a test that fakes the clock so refill is checked without sleeping.
