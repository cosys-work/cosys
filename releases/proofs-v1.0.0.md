# Proofs v1.0.0

The Lean 4 proofs for *Collaboration Is Composition: Mealy Machines over Signed Records in Poly and Org*, together with the packages that implement its model.

- `proofs/CosysCore` uses core Lean only. It covers polynomials, their maps, the tensor, dynamical systems and partitions, and holds the results on the network, Org, gluing and trust.
- `proofs/CosysCalco` uses Mathlib. It holds Mealy machines and congruence, order independence, claims as types, and grades.
- `proofs/Check.lean` prints the axioms behind each main result. Every result rests only on Lean's standard axioms (`propext`, `Quot.sound`, `Classical.choice`).

Built with Lean v4.35.0 and Mathlib v4.35.0. To check the proofs:

```
cd proofs
lake exe cache get
lake build
lake env lean Check.lean
```

`lake build CosysCore` needs no Mathlib.
