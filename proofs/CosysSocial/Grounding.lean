import Mathlib.Order.Monotone.Basic
import Mathlib.Data.Set.Finite.Basic
import Mathlib.Data.Set.Lattice.Indexed
import CosysCore.Gluing

/-!
# Grounding conditions

The definition *Grounding condition* and the claim of *Facts that ask for an absence* in *What
Absence Costs*, as order theory on sets of records.

Under a fixed frame a fact has a grounding condition, a condition on the records that says when the
fact holds. A condition asks only for records when adding records never makes it fail, and it asks
for an absence when it holds of some set of records and fails of a larger one. `sort` says every
condition does exactly one of the two. A condition that asks only for records holds exactly when the
log holds one of a family of witness sets, and an absence always comes down to one record whose
absence the fact needs (`absence_step`). Read by observers, a condition asks only for records exactly
when every observer's conclusion from its own records holds of all the records together
(`positive_iff_local_sound`), which is the nurse's case in the paper.
-/

namespace Cosys.Social

variable {R : Type}

/-- A *grounding condition*: when a fact holds of a set of records, under a fixed frame. -/
abbrev Grounding (R : Type) := Set R → Prop

/-- The condition asks only that records exist: adding records never makes it fail. -/
def Positive (G : Grounding R) : Prop := Monotone G

/-- The condition asks for an absence: it holds of some set of records and fails of a larger one. -/
def AsksAbsence (G : Grounding R) : Prop := ∃ X Y, X ⊆ Y ∧ G X ∧ ¬ G Y

/-- **The sort.** A grounding condition asks only for records or asks for an absence, and never
both. -/
theorem sort (G : Grounding R) : Positive G ↔ ¬ AsksAbsence G := by
  constructor
  · rintro h ⟨X, Y, hXY, hX, hY⟩
    exact hY (h hXY hX)
  · intro h X Y hXY hX
    by_contra hY
    exact h ⟨X, Y, hXY, hX, hY⟩

/-- A condition asks only for records exactly when it holds of a log once the log contains one of a
family of witness sets. -/
theorem positive_iff_witnessed (G : Grounding R) :
    Positive G ↔ ∃ W : Set (Set R), ∀ X, G X ↔ ∃ w ∈ W, w ⊆ X := by
  constructor
  · intro h
    exact ⟨{w | G w}, fun X => ⟨fun hX => ⟨X, hX, Set.Subset.rfl⟩, fun ⟨_, hw, hwX⟩ => h hwX hw⟩⟩
  · rintro ⟨W, hW⟩ X Y hXY hX
    obtain ⟨w, hw, hwX⟩ := (hW X).1 hX
    exact (hW Y).2 ⟨w, hw, hwX.trans hXY⟩

/-- A condition that asks only for records, and that a finite part of a log decides whenever it
holds, holds of a log exactly when a finite part of the log meets it. -/
theorem positive_finite_witness {G : Grounding R} (hG : Positive G)
    (hc : ∀ X, G X → ∃ w ⊆ X, w.Finite ∧ G w) :
    ∀ X, G X ↔ ∃ w ⊆ X, w.Finite ∧ G w := by
  intro X
  exact ⟨hc X, fun ⟨_, hwX, _, hw⟩ => hG hwX hw⟩

/-- The record `r` defeats `G` at `Z`: `G` holds of `Z` and fails once `r` is added. -/
def Defeats (G : Grounding R) (Z : Set R) (r : R) : Prop := G Z ∧ ¬ G (insert r Z)

/-- **An absence is the absence of a record.** If `G` holds of `X` and fails of a larger `Y`, with
finitely many records between them, some record of `Y` defeats `G` at a log between the two. -/
theorem absence_step {G : Grounding R} {X Y : Set R} (hXY : X ⊆ Y) (hfin : (Y \ X).Finite)
    (hX : G X) (hY : ¬ G Y) : ∃ Z r, X ⊆ Z ∧ insert r Z ⊆ Y ∧ r ∉ Z ∧ Defeats G Z r := by
  -- Add the records of `Y \ X` one at a time; the first that makes `G` fail defeats it.
  have key : ∀ D : Set R, D.Finite → ∀ Z, G Z → ¬ G (Z ∪ D) →
      ∃ Z' r, Z ⊆ Z' ∧ insert r Z' ⊆ Z ∪ D ∧ r ∉ Z' ∧ Defeats G Z' r := by
    intro D hD
    induction D, hD using Set.Finite.induction_on with
    | empty => intro Z hZ hZD; exact absurd (by simpa using hZ) hZD
    | @insert a D _ _ ih =>
      intro Z hZ hZD
      by_cases ha : G (insert a Z)
      · have hZD' : ¬ G (insert a Z ∪ D) := by
          rwa [Set.insert_union, ← Set.union_insert]
        obtain ⟨Z', r, hZZ', hrZ', hr, hdef⟩ := ih (insert a Z) ha hZD'
        refine ⟨Z', r, (Set.subset_insert a Z).trans hZZ', hrZ'.trans ?_, hr, hdef⟩
        rw [Set.insert_union, ← Set.union_insert]
      · refine ⟨Z, a, Set.Subset.rfl, ?_, fun haZ => ha (by rwa [Set.insert_eq_of_mem haZ]), hZ, ha⟩
        exact Set.insert_subset (Or.inr (Set.mem_insert a D)) Set.subset_union_left
  obtain ⟨Z, r, h1, h2, h3, h4⟩ := key (Y \ X) hfin X hX (by rwa [Set.union_sdiff_cancel hXY])
  exact ⟨Z, r, h1, h2.trans (by rw [Set.union_sdiff_cancel hXY]), h3, h4⟩

/-- **The sort, read by observers.** A condition asks only for records exactly when every observer's
conclusion from its own records holds of all the records together. The records together are
`Cosys.Gluing.glue L` when the observers' logs are glued on a cover of audiences. -/
theorem positive_iff_local_sound (G : Grounding R) :
    Positive G ↔ ∀ (ι : Type) (L : ι → Set R) (i : ι), G (L i) → G (⋃ j, L j) := by
  constructor
  · intro h ι L i hi
    exact h (Set.subset_iUnion L i) hi
  · intro h X Y hXY hX
    have hU : (⋃ b : Bool, cond b X Y) = Y := by
      apply Set.Subset.antisymm
      · exact Set.iUnion_subset fun b => by cases b <;> simp [hXY]
      · exact Set.subset_iUnion (fun b : Bool => cond b X Y) false
    have := h Bool (fun b => cond b X Y) true hX
    rwa [hU] at this

end Cosys.Social
