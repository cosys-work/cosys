# Proofs v1.2.0

Results for parties on different versions and for bounded storage, added to `CosysSocial`, the library for *What Absence Costs*. `CosysCore` and `CosysCalco` are unchanged from `proofs-v1.0.0`, and the rest of `CosysSocial` from `proofs-v1.1.0`.

- `proofs/CosysSocial/Versions.lean` is new. A condition that asks only for records still does when read through any record-wise view; a view that identifies two records is blind to the second once the first is present, so no condition on what it shows tracks a fact the second defeats; a translation with a complement that loses nothing in either direction gives a lens satisfying GetPut and PutGet, and lenses compose; and a unit that reads its log through a view, and emits a fact once a condition that asks only for records holds of what it reads, settles the same way under every fair schedule, which is the CALM line for parties on different versions.
- `proofs/CosysSocial/Summary.lean` is new. A summary sealed as of a checkpoint answers a question that asks only for records as the records it replaces would.
- `proofs/Check.lean` prints the axioms behind each main result of the three libraries. Every result rests only on Lean's standard axioms (`propext`, `Quot.sound`, `Classical.choice`).

Built with Lean v4.35.0 and Mathlib v4.35.0. To check the proofs:

```
cd proofs
lake exe cache get
lake build
lake env lean Check.lean
```

`lake build CosysCore` needs no Mathlib.
