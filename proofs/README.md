# Proofs

Lean 4 proofs of the results in our paper *Collaboration Is Composition: Mealy Machines over Signed
Records in Poly and Org*. The model is the one the `@cosys` packages implement: every party acts
through a Mealy machine over an append-only log of signed records, and a collaboration is those
machines wired together through mailboxes.

Release `proofs-v1.0.0` is archived on Zenodo under the DOI
[10.5281/zenodo.24026063](https://doi.org/10.5281/zenodo.24026063).

There are two libraries. `CosysCore` uses core Lean only:

| File | Results |
| --- | --- |
| `CosysCore/Basic.lean` | Polynomials, their maps, the tensor, dynamical systems `S y^S → p`, partitions |
| `CosysCore/Network.lean` | A unit with its mailboxes is a dynamical system that delivers each envelope once; changing wiring as a map of polynomials, with its identity and nesting laws |
| `CosysCore/Org.lean` | Registries of pairings: the identitor and compositor of a dynamic multicategory in the sense of Shapiro and Spivak, and their equations on the pairings held |
| `CosysCore/Gluing.lean` | Gluing of record sets, and the sheaf condition on an audience cover |
| `CosysCore/Trust.lean` | Trust as a split fibration over observers: cartesian lifts, unique factorisation, strict composition of lifts |

`CosysCalco` uses Mathlib:

| File | Results |
| --- | --- |
| `CosysCalco/Mealy.lean` | Boxes as Mealy machines, collaborations over a stream of events, congruence of bisimilarity |
| `CosysCalco/Order.lean` | Monotone boxes and the receive rule, read in any order; order independence with finitely many units, with unboundedly many units, and for chains, with `Out` read through finite subsets; outside inputs, and a pairing that forms inside a run; growing wiring; no global quiescence; a non-monotone condition from any point of a run; rounds |
| `CosysCalco/Claims.lean` | Grades of records, claim types with accountable keys, acceptance, reserved claims, placement of agents, and the decision procedure run on an example |
| `CosysCalco/Grades.lean` | The lattice of grades, provenance as `PosBool`, acceptance as its universal property |

## Building

The toolchain is pinned in `lean-toolchain`, and Mathlib in `lakefile.toml`.

```sh
cd proofs
lake exe cache get        # compiled Mathlib; without it, lake build compiles the parts we import
lake build
lake env lean Check.lean  # the axioms behind each main result
```

`lake build CosysCore` needs no Mathlib. Every result rests only on Lean's standard axioms
(`propext`, `Quot.sound`, `Classical.choice`), which `Check.lean` prints one result at a time.
