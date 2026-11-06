import Mathlib.Order.Hom.BoundedLattice
import Mathlib.Algebra.Ring.Defs
import Mathlib.Data.Finset.SDiff
import Mathlib.Data.Fintype.EquivFin
import CosysCalco.Claims

/-!
# Grades and acceptance without numbers

The theorem *Grades* of *Collaboration Is Composition*.

A derived fact carries its provenance, a positive Boolean expression over the records it was
derived from: conjunction for premises used together, disjunction for alternative derivations.
`PosBool X` is these expressions up to equivalence, where two expressions are equivalent when every
valuation of the records gives them the same value. An observer's valuation of records extends to
its acceptance of every derived fact.

On part (i): finite sets of role and key pairs, ordered by inclusion, form a generalized Boolean
lattice, with relative complements and no top once there are infinitely many keys. All sets of
such pairs form a Boolean lattice.
-/

namespace Cosys.Calco

/-! ## (i) The lattice of grades -/

/-- Finite sets of role and key pairs form a generalized Boolean lattice. -/
example {Role Key : Type} [DecidableEq Role] [DecidableEq Key] :
    GeneralizedBooleanAlgebra (Finset (Role × Key)) :=
  inferInstance

/-- With infinitely many role and key pairs, finite sets of them have no top, so they do not form a
Boolean lattice. -/
theorem finset_no_top {α : Type} [Infinite α] : ¬ ∃ t : Finset α, ∀ s : Finset α, s ⊆ t := by
  rintro ⟨t, ht⟩
  obtain ⟨a, ha⟩ := Infinite.exists_notMem_finset t
  exact ha (ht {a} (Finset.mem_singleton_self a))

/-- **Grades (i).** In a finite log a grade is finite, and it grows with the log. -/
theorem grade_finite {R Role Key K U : Type} (S : Signed R Role Key K U) {L : Set R} (hL : L.Finite)
    (r : R) : (grade S L r).Finite := by
  refine (Set.finite_singleton _).union
    ((hL.image fun s => ((S.cosign s).elim (S.authorRole s) Prod.snd, S.author s)).subset ?_)
  rintro ⟨ρ, k⟩ ⟨s, hs, hc, ha, -⟩
  refine ⟨s, hs, ?_⟩
  simp only at hc ha
  simp [hc, ha]

/-! ## (ii) Positive Boolean expressions -/

/-- Positive Boolean expressions over `X`. -/
inductive PosExpr (X : Type) where
  | var (x : X)
  | tt
  | ff
  | or (a b : PosExpr X)
  | and (a b : PosExpr X)

variable {X : Type}

/-- The value of an expression under a valuation. -/
def PosExpr.eval (ν : X → Bool) : PosExpr X → Bool
  | var x => ν x
  | tt => true
  | ff => false
  | or a b => a.eval ν || b.eval ν
  | and a b => a.eval ν && b.eval ν

/-- Two expressions are equivalent when every valuation gives them the same value. -/
instance PosExpr.setoid : Setoid (PosExpr X) where
  r a b := ∀ ν, a.eval ν = b.eval ν
  iseqv := ⟨fun _ _ => rfl, fun h ν => (h ν).symm, fun h h' ν => (h ν).trans (h' ν)⟩

/-- `PosBool X`: positive Boolean expressions over `X` up to equivalence. -/
def PosBool (X : Type) : Type := Quotient (PosExpr.setoid (X := X))

namespace PosBool

/-- The record `x` as a provenance. -/
def var (x : X) : PosBool X := ⟦PosExpr.var x⟧

/-- The value of a provenance under each valuation. -/
def denote : PosBool X → (X → Bool) → Bool :=
  Quotient.lift (fun e ν => e.eval ν) (fun _ _ h => funext h)

theorem denote_injective : Function.Injective (denote (X := X)) := by
  intro a b h
  induction a using Quotient.ind
  induction b using Quotient.ind
  exact Quotient.sound (congrFun h)

instance : Max (PosBool X) :=
  ⟨Quotient.map₂ PosExpr.or fun _ _ h _ _ h' ν => by simp only [PosExpr.eval, h ν, h' ν]⟩

instance : Min (PosBool X) :=
  ⟨Quotient.map₂ PosExpr.and fun _ _ h _ _ h' ν => by simp only [PosExpr.eval, h ν, h' ν]⟩

instance : Top (PosBool X) := ⟨⟦PosExpr.tt⟧⟩

instance : Bot (PosBool X) := ⟨⟦PosExpr.ff⟧⟩

instance : LE (PosBool X) := ⟨fun a b => denote a ≤ denote b⟩

instance : LT (PosBool X) := ⟨fun a b => denote a < denote b⟩

theorem denote_sup (a b : PosBool X) : denote (a ⊔ b) = denote a ⊔ denote b := by
  induction a using Quotient.ind
  induction b using Quotient.ind
  rfl

theorem denote_inf (a b : PosBool X) : denote (a ⊓ b) = denote a ⊓ denote b := by
  induction a using Quotient.ind
  induction b using Quotient.ind
  rfl

/-- **Grades (ii)**, the lattice. `PosBool X` is a distributive lattice. -/
instance : DistribLattice (PosBool X) :=
  denote_injective.distribLattice _ Iff.rfl Iff.rfl denote_sup denote_inf

/-- `PosBool X` has a top and a bottom: the true and the false expressions. -/
instance : BoundedOrder (PosBool X) where
  le_top a := by
    induction a using Quotient.ind
    intro ν
    exact le_top
  bot_le a := by
    induction a using Quotient.ind
    intro ν
    exact bot_le

/-- **Grades (ii)**, the semiring. With disjunction as addition and conjunction as multiplication,
`PosBool X` is a commutative semiring. -/
instance : Zero (PosBool X) := ⟨⊥⟩

instance : One (PosBool X) := ⟨⊤⟩

instance : Add (PosBool X) := ⟨(· ⊔ ·)⟩

instance : Mul (PosBool X) := ⟨(· ⊓ ·)⟩

instance : CommSemiring (PosBool X) where
  add_assoc := sup_assoc
  zero_add := bot_sup_eq
  add_zero := sup_bot_eq
  add_comm := sup_comm
  mul_assoc := inf_assoc
  one_mul := top_inf_eq
  mul_one := inf_top_eq
  left_distrib := inf_sup_left
  right_distrib := inf_sup_right
  zero_mul := bot_inf_eq
  mul_zero := inf_bot_eq
  mul_comm := inf_comm
  nsmul := nsmulRec
  npow := npowRec

/-- **Grades (ii)**: both operations are idempotent. -/
theorem add_idem (a : PosBool X) : a + a = a :=
  sup_idem a

/-- **Grades (ii)**: both operations are idempotent. -/
theorem mul_idem (a : PosBool X) : a * a = a :=
  inf_idem a

/-! ## (iii) Acceptance -/

/-- The extension of a valuation of records to every provenance. -/
def lift (ν : X → Bool) : BoundedLatticeHom (PosBool X) Bool where
  toFun a := denote a ν
  map_sup' a b := congrFun (denote_sup a b) ν
  map_inf' a b := congrFun (denote_inf a b) ν
  map_top' := rfl
  map_bot' := rfl

/-- **Grades (iii).** The extension agrees with the valuation on records. -/
theorem lift_var (ν : X → Bool) (x : X) : lift ν (var x) = ν x := rfl

/-- **Grades (iii).** It is the only homomorphism of bounded lattices that does. -/
theorem lift_unique (ν : X → Bool) (f : BoundedLatticeHom (PosBool X) Bool)
    (hf : ∀ x, f (var x) = ν x) : f = lift ν := by
  ext a
  induction a using Quotient.ind with
  | _ e =>
    induction e with
    | var x => exact hf x
    | tt => exact map_top f
    | ff => exact map_bot f
    | or a b iha ihb =>
      calc f ⟦a.or b⟧ = f ⟦a⟧ ⊔ f ⟦b⟧ := f.map_sup' ⟦a⟧ ⟦b⟧
        _ = lift ν ⟦a⟧ ⊔ lift ν ⟦b⟧ := by rw [iha, ihb]
        _ = lift ν ⟦a.or b⟧ := ((lift ν).map_sup' ⟦a⟧ ⟦b⟧).symm
    | and a b iha ihb =>
      calc f ⟦a.and b⟧ = f ⟦a⟧ ⊓ f ⟦b⟧ := f.map_inf' ⟦a⟧ ⟦b⟧
        _ = lift ν ⟦a⟧ ⊓ lift ν ⟦b⟧ := by rw [iha, ihb]
        _ = lift ν ⟦a.and b⟧ := ((lift ν).map_inf' ⟦a⟧ ⟦b⟧).symm

/-- **Grades (iii).** Two observers who accept the same records accept the same derived facts. -/
theorem lift_congr (ν ν' : X → Bool) (h : ∀ x, ν x = ν' x) (a : PosBool X) :
    lift ν a = lift ν' a := by
  have hν : ν = ν' := funext h
  subst hν
  rfl

end PosBool

end Cosys.Calco
