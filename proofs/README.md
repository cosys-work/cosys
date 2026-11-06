# Proofs

Lean 4 proofs of the results in our paper *Collaboration Without Orchestration: composable Mealy
machines over signed records, and trust as a fibration over observers*. The model is the one the
`@cosys` packages implement: every party acts through a Mealy machine over an append-only log of
signed records, and a collaboration is those machines wired together through mailboxes.

There are two libraries. `CosysCore` uses core Lean only:

| File | Results |
| --- | --- |
| `CosysCore/Basic.lean` | Polynomials, their maps, the tensor, dynamical systems `S y^S → p`, partitions |
| `CosysCore/Network.lean` | A unit with its mailboxes is a dynamical system; changing wiring as a map of polynomials, with its identity and nesting laws |
| `CosysCore/Org.lean` | Registries of pairings form a dynamic multicategory in the sense of Shapiro and Spivak |
| `CosysCore/Gluing.lean` | Gluing of record sets, and the sheaf condition on an audience cover |
| `CosysCore/Trust.lean` | Trust as a split fibration over observers; a ranking is computed inside one fiber |

`CosysCalco` uses Mathlib:

| File | Results |
| --- | --- |
| `CosysCalco/Mealy.lean` | Boxes as Mealy machines, collaborations over a stream of events, congruence of bisimilarity |
| `CosysCalco/Order.lean` | Monotone boxes; order independence with finitely many units, with unboundedly many units, and for chains; no global quiescence; a non-monotone condition; rounds |
| `CosysCalco/Claims.lean` | Grades of records, claim types with accountable keys, reserved claims, placement of agents |
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
