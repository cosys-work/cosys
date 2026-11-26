# Proofs v1.1.0

The Lean 4 proofs for *What Absence Costs*, beside those for *Collaboration Is Composition: Mealy Machines over Signed Records in Poly and Org*, which are unchanged from `proofs-v1.0.0`.

- `proofs/CosysSocial` is new. It uses Mathlib and builds on `CosysCore` and `CosysCalco`. It holds the sort of grounding conditions into those that ask only for records and those that ask for an absence, CALM for social facts in the network model of the first paper, seals as claim types, authority rules on grades with quorums and facades, frames in layers, the form of positive conditions as positive Boolean expressions, and the paper's examples.
- `proofs/CosysCore` and `proofs/CosysCalco` are as released in `proofs-v1.0.0`.
- `proofs/Check.lean` prints the axioms behind each main result of the three libraries. Every result rests only on Lean's standard axioms (`propext`, `Quot.sound`, `Classical.choice`).

Built with Lean v4.35.0 and Mathlib v4.35.0. To check the proofs:

```
cd proofs
lake exe cache get
lake build
lake env lean Check.lean
```

`lake build CosysCore` needs no Mathlib.
