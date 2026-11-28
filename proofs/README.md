# Proofs

Lean 4 proofs of the results in our papers *Collaboration Is Composition: Mealy Machines over Signed
Records in Poly and Org* ([doi:10.5281/zenodo.24026645](https://doi.org/10.5281/zenodo.24026645)) and *What Absence Costs* ([doi:10.5281/zenodo.24566902](https://doi.org/10.5281/zenodo.24566902)). The model is the one the `@cosys` packages implement: every party acts
through a Mealy machine over an append-only log of signed records, and a collaboration is those
machines wired together through mailboxes.

Release `proofs-v1.0.0`, with the proofs for the first paper, is archived on Zenodo under the DOI
[10.5281/zenodo.24026063](https://doi.org/10.5281/zenodo.24026063). Release `proofs-v1.1.0` adds
the proofs for the second, under the DOI
[10.5281/zenodo.24566342](https://doi.org/10.5281/zenodo.24566342). Release `proofs-v1.2.0` adds
the results for parties on different versions and for bounded storage, under the DOI
[10.5281/zenodo.24626245](https://doi.org/10.5281/zenodo.24626245).

There are three libraries. `CosysCore` uses core Lean only:

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

`CosysSocial` builds on both and holds the results of *What Absence Costs*, on which social facts
need an authority:

| File | Results |
| --- | --- |
| `CosysSocial/Grounding.lean` | Grounding conditions, the sort into those that ask only for records and those that ask for an absence, finite witnesses, one record whose absence a fact needs, and the observers' test |
| `CosysSocial/Calm.lean` | Facts as monotone boxes, and CALM for social facts: over countably many records, a fact whose absences show over finitely many records settles the same way under every fair schedule exactly when it asks only for records |
| `CosysSocial/Seal.lean` | Seals as claim types, the latest seal, validity and revocation lists, joint seals that no party makes or reopens alone, an observer's checkpoint, and seals made by an office |
| `CosysSocial/Authority.lean` | Authority rules as conditions on grades, with the first paper's claim types as the rules that ask for a fixed set; quorums; a governing body's facade, behind which attribution survives; what concerns one person alone; no rotation of members by a captured majority; suspensions |
| `CosysSocial/Layers.lean` | Frames, customizations that add, rules kept as records, and translations between vocabularies that keep presence facts |
| `CosysSocial/Positive.lean` | Over finitely many records, asking only for records as a positive Boolean expression, and quorums as positive Boolean expressions over signatures |
| `CosysSocial/Versions.lean` | Parties on different versions: a condition that asks only for records still does through any record-wise view, a lossy view misses a defeat, a translation with a complement that loses nothing gives a lens, lenses compose, and CALM for a unit that reads its log through a view |
| `CosysSocial/Summary.lean` | A summary sealed as of a checkpoint answers a positive question as the records it replaces would |
| `CosysSocial/Examples.lean` | The committee, the night nurse, the camera and the duelling administrators, decided on small instances |

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
