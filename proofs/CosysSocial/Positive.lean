import Mathlib.Data.Fintype.Powerset
import CosysCalco.Grades
import CosysSocial.Authority

/-!
# Asking only for records, as an expression

The claim of *Facts that ask for an absence* that, over finitely many records, "asks only for
records" has a syntactic form, and the description of quorums in *Who seals for the sealers*, in
*What Absence Costs*.

Over finitely many records, a condition asks only for records exactly when it is a positive Boolean
expression in the presence of records, the expressions `CosysCalco.Grades` uses for provenance
(`positive_iff_posBool`). Over finitely many signatures the same holds for authority rules, so
quorums and joint rules are positive Boolean expressions over signatures (`rule_iff_posBool`).
-/

namespace Cosys.Social

open Cosys.Calco Classical

variable {R Role Key P : Type}

/-- The conjunction of the variables of a list. -/
def allOf {X : Type} : List X → PosExpr X
  | [] => .tt
  | x :: l => .and (.var x) (allOf l)

theorem eval_allOf {X : Type} (ν : X → Bool) (l : List X) :
    (allOf l).eval ν = true ↔ ∀ x ∈ l, ν x = true := by
  induction l with
  | nil => simp [allOf, PosExpr.eval]
  | cons x l ih => simp [allOf, PosExpr.eval, ih]

/-- The disjunction of a list of expressions. -/
def anyOf {X : Type} : List (PosExpr X) → PosExpr X
  | [] => .ff
  | e :: l => .or e (anyOf l)

theorem eval_anyOf {X : Type} (ν : X → Bool) (l : List (PosExpr X)) :
    (anyOf l).eval ν = true ↔ ∃ e ∈ l, e.eval ν = true := by
  induction l with
  | nil => simp [anyOf, PosExpr.eval]
  | cons e l ih => simp [anyOf, PosExpr.eval, ih]

/-- **Over finitely many records, asking only for records is a positive Boolean expression** in the
presence of records. -/
theorem positive_iff_posBool [Finite R] (G : Grounding R) :
    Positive G ↔ ∃ e : PosBool R, ∀ X, G X ↔ PosBool.denote e (fun r => decide (r ∈ X)) = true := by
  constructor
  · -- The disjunction, over the finite sets of records that meet `G`, of their conjunctions.
    intro hG
    have : Fintype R := Fintype.ofFinite R
    let ws : List (Finset R) := (Finset.univ.filter fun w : Finset R => G ↑w).toList
    refine ⟨⟦anyOf (ws.map fun w => allOf w.toList)⟧, fun X => ?_⟩
    show G X ↔ (anyOf _).eval _ = true
    rw [eval_anyOf]
    simp only [List.mem_map, ws, Finset.mem_toList, Finset.mem_filter, Finset.mem_univ, true_and]
    constructor
    · intro hX
      refine ⟨_, ⟨(Set.toFinite X).toFinset, by rwa [Set.Finite.coe_toFinset], rfl⟩, ?_⟩
      rw [eval_allOf]
      intro r hr
      simpa using hr
    · rintro ⟨_, ⟨w, hw, rfl⟩, he⟩
      rw [eval_allOf] at he
      exact hG (fun r hr => by simpa using he r (by simpa using hr)) hw
  · rintro ⟨e, he⟩ X Y hXY hX
    rw [he] at hX ⊢
    exact Bool.le_iff_imp.mp (denote_mono e hXY) hX

/-- **Over finitely many signatures, a rule monotone in the grade is a positive Boolean expression**
over signatures. -/
theorem rule_iff_posBool [Finite (Role × Key)] (ρ : Rule R Role Key P) (x : P) (L : Set R) :
    Monotone (ρ.ok x L) ↔
      ∃ e : PosBool (Role × Key),
        ∀ g, ρ.ok x L g ↔ PosBool.denote e (fun s => decide (s ∈ g)) = true :=
  positive_iff_posBool (ρ.ok x L)

end Cosys.Social
