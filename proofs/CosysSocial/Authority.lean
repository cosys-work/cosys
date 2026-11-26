import Mathlib.Data.Finset.Card
import CosysCalco.Grades
import CosysSocial.Calm
import CosysSocial.Seal

/-!
# Authority rules, quorums and facades

The sections *Who seals for the sealers*, *The contractualist test, in tiers* and *What a
suspension costs* of *What Absence Costs*.

The authority rule of *Collaboration Is Composition* asks for a fixed set of signatures. A quorum
asks for any large enough subset, so this file reads an authority rule as a condition on grades
(`Rule`), with the claim types of that paper as the rules that ask for a fixed set
(`claimBy_conj`). A claim type grows with the log when its rule is monotone in the grade and in the
log (`claimBy_mono`), and quorums and rules written as positive Boolean expressions over signatures
are (`quorum_monotone`, `posBool_monotone`).

A governing body signs through one facade, a threshold signature read through its shares: the
facade has signed a record when the body's inner log holds shares of it from enough accountable
members. Attribution survives behind the facade, and a minority cannot sign for the body
(`facade_attribution`, `facade_minority`). Unforgeability of the shares is a cryptographic
assumption outside the model.

What concerns one person alone needs that person's own signature, so no quorum reaches it
(`personal_beyond_quorum`), and a change of membership under the first tier needs every member, so a
captured majority cannot rotate members out (`no_rotation_by_capture`). An office-holder's act
counts only if no suspension of it came first, which asks for an absence, so a suspension cannot
take effect everywhere at once (`suspension_splits`).
-/

namespace Cosys.Social

open Cosys.Calco Classical

variable {R Role Key K U P : Type}

/-- An authority rule as a condition on grades: which sets of signatures suffice for a claim with
parameters `x` in the log `L`. -/
structure Rule (R Role Key P : Type) where
  ok : P → Set R → Set (Role × Key) → Prop

variable (S : Signed R Role Key K U)

/-- The claim type under a rule `ρ`: records of the log, by accountable authors, of the kind, naming
the parameters, whose grade the rule accepts. -/
def claimBy (kind : K) (names : R → P → Prop) (ρ : Rule R Role Key P) (x : P) (L : Set R) :
    Set R :=
  {r | r ∈ L ∧ Accountable S L (S.author r) ∧ S.kind r = kind ∧ names r x ∧
    ρ.ok x L (grade S L r)}

/-- **The claim types of *Collaboration Is Composition* are the rules that ask for a fixed set of
signatures.** -/
theorem claimBy_conj (C : ClaimKind R Role Key K) (x : C.Param) (L : Set R) :
    claimBy S C.kind C.names ⟨fun x L g => C.auth x L ⊆ g⟩ x L = Claim S C x L := by
  rfl

/-- A claim type grows with the log when its rule is monotone in the grade and in the log. -/
theorem claimBy_mono {kind : K} {names : R → P → Prop} {ρ : Rule R Role Key P}
    (hg : ∀ x L, Monotone (ρ.ok x L)) (hL : ∀ x g, Monotone fun L => ρ.ok x L g) (x : P) :
    Monotone (claimBy S kind names ρ x) := by
  rintro L L' h r ⟨hrL, hacc, hk, hn, hok⟩
  exact ⟨h hrL, hacc.mono h, hk, hn, hg x L' (grade_mono h r) (hL x _ h hok)⟩

/-- Every signature in a record's grade was made by a record of the log. -/
theorem signer_in_log {L : Set R} {r : R} (hr : r ∈ L) {g : Role × Key} (hg : g ∈ grade S L r) :
    ∃ s ∈ L, S.author s = g.2 := by
  rcases hg with hg | ⟨s, hs, -, ha, -⟩
  · exact ⟨r, hr, by rw [Set.mem_singleton_iff.mp hg]⟩
  · exact ⟨s, hs, ha⟩

/-- A positive Boolean expression only turns true as more of its variables do. -/
theorem PosExpr.eval_mono {X : Type} {ν ν' : X → Bool} (h : ∀ x, ν x = true → ν' x = true)
    (a : PosExpr X) : a.eval ν = true → a.eval ν' = true := by
  induction a with
  | var x => exact h x
  | tt => exact id
  | ff => exact id
  | or a b iha ihb =>
    simp only [PosExpr.eval, Bool.or_eq_true]
    exact Or.imp iha ihb
  | and a b iha ihb =>
    simp only [PosExpr.eval, Bool.and_eq_true]
    exact And.imp iha ihb

/-- Read on the presence of its variables in a set, a positive Boolean expression grows with the
set. -/
theorem denote_mono {X : Type} (e : PosBool X) :
    Monotone fun g : Set X => PosBool.denote e fun s => decide (s ∈ g) := by
  intro g g' h
  induction e using Quotient.ind with
  | _ a =>
    show a.eval _ ≤ a.eval _
    exact Bool.le_iff_imp.mpr
      (PosExpr.eval_mono (fun x hx => by simpa using h (by simpa using hx)) a)

/-- *Quorum*: at least `q` of the members `M` signed in the role `role`. -/
noncomputable def quorum (M : Finset Key) (q : ℕ) (role : Role) : Rule R Role Key P :=
  ⟨fun _ _ g => q ≤ (M.filter fun k => (role, k) ∈ g).card⟩

/-- A quorum rule is monotone in the grade: more signatures never undo a quorum. -/
theorem quorum_monotone (M : Finset Key) (q : ℕ) (role : Role) :
    ∀ x L, Monotone ((quorum M q role : Rule R Role Key P).ok x L) := by
  intro x L g g' h hq
  refine hq.trans (Finset.card_le_card fun k hk => ?_)
  rw [Finset.mem_filter] at hk ⊢
  exact ⟨hk.1, h hk.2⟩

/-- A rule written as a positive Boolean expression over signatures, the expressions
`CosysCalco.Grades` uses for provenance, is monotone in the grade. -/
theorem posBool_monotone (e : PosBool (Role × Key)) :
    Monotone fun g : Set (Role × Key) => PosBool.denote e fun s => decide (s ∈ g) := by
  exact denote_mono e

/-- A *facade* of a governing body, read through its shares. -/
structure Facade (R Key : Type) where
  /-- The body's members. -/
  members : Finset Key
  /-- How many members' shares make the facade's signature. -/
  q : ℕ
  /-- `share s = some r`: `s` is its author's share of the facade's signature on `r`. -/
  share : R → Option R

/-- The facade has signed `r` in the log `L`: at least `q` of its members, each accountable, have a
share of its signature on `r` in `L`. -/
noncomputable def Facade.signed (F : Facade R Key) (L : Set R) (r : R) : Prop :=
  F.q ≤ (F.members.filter fun k =>
    ∃ s ∈ L, F.share s = some r ∧ S.author s = k ∧ Accountable S L k).card

/-- **Attribution survives behind the facade.** When the facade has signed `r`, a quorum of named
members each has a share of it in the log, with an accountable key. -/
theorem facade_attribution {F : Facade R Key} {L : Set R} {r : R} (h : F.signed S L r) :
    ∃ T ⊆ F.members, F.q ≤ T.card ∧
      ∀ k ∈ T, ∃ s ∈ L, F.share s = some r ∧ S.author s = k ∧ Accountable S L k := by
  exact ⟨_, Finset.filter_subset _ _, h, fun k hk => (Finset.mem_filter.mp hk).2⟩

/-- A facade's signature only grows with the log. -/
theorem facade_positive (F : Facade R Key) (r : R) : Positive fun L => F.signed S L r := by
  intro L L' h hq
  refine le_trans hq (Finset.card_le_card fun k hk => ?_)
  rw [Finset.mem_filter] at hk ⊢
  obtain ⟨hkM, s, hs, hsh, ha, hacc⟩ := hk
  exact ⟨hkM, s, h hs, hsh, ha, hacc.mono h⟩

/-- **A minority cannot sign for the body.** If every share in the log comes from a set of fewer
than `q` keys, the facade has signed nothing. -/
theorem facade_minority {F : Facade R Key} {L : Set R} {r : R} (C : Finset Key)
    (hC : C.card < F.q) (hL : ∀ s ∈ L, F.share s ≠ none → S.author s ∈ C) :
    ¬ F.signed S L r := by
  intro hq
  have hsub : (F.members.filter fun k =>
      ∃ s ∈ L, F.share s = some r ∧ S.author s = k ∧ Accountable S L k) ⊆ C := by
    intro k hk
    obtain ⟨-, s, hs, hsh, rfl, -⟩ := Finset.mem_filter.mp hk
    exact hL s hs (by rw [hsh]; exact Option.some_ne_none r)
  exact absurd (le_trans hq (Finset.card_le_card hsub)) (not_le.mpr hC)

/-- *What concerns one person alone*: whatever else the rule asks, it asks for that person's
signature. -/
def Personal (ρ : Rule R Role Key P) (p : Key) (role : Role) : Prop :=
  ∀ x L g, ρ.ok x L g → (role, p) ∈ g

/-- **No quorum reaches what concerns one person alone.** If the person signed nothing in the log,
the claim type is empty, whatever the rest of the body signed. -/
theorem personal_beyond_quorum {kind : K} {names : R → P → Prop} {ρ : Rule R Role Key P}
    {p : Key} {role : Role} (hp : Personal ρ p role) {L : Set R}
    (hsilent : ∀ s ∈ L, S.author s ≠ p) (x : P) : claimBy S kind names ρ x L = ∅ := by
  apply Set.eq_empty_of_subset_empty
  rintro r ⟨hrL, -, -, -, hok⟩
  obtain ⟨s, hs, ha⟩ := signer_in_log S hrL (hp x L _ hok)
  exact hsilent s hs ha

/-- The rule of the first tier: every member's signature, in the role `role`. -/
def unanimous (M : Finset Key) (role : Role) : Rule R Role Key P :=
  ⟨fun _ _ g => ∀ k ∈ M, (role, k) ∈ g⟩

/-- **No rotation by capture.** A change of membership under the first tier asks for every member's
signature, so a coalition that leaves one member out cannot make it, however large. -/
theorem no_rotation_by_capture {kind : K} {names : R → P → Prop} {M : Finset Key} {role : Role}
    {coalition : Set Key} {k : Key} (hk : k ∈ M) (hout : k ∉ coalition) {L : Set R}
    (hL : ∀ s ∈ L, S.author s ∈ coalition) (x : P) :
    claimBy S kind names (unanimous M role) x L = ∅ := by
  apply Set.eq_empty_of_subset_empty
  rintro r ⟨hrL, -, -, -, hok⟩
  obtain ⟨s, hs, ha⟩ := signer_in_log S hrL (hok k hk)
  exact hout (by simpa [ha] using hL s hs)

/-- **A suspension cannot take effect everywhere at once.** An office-holder's act `a` counts only if
no suspension of it came first, which asks for an absence, so there is a network of one reader and
two fair schedules: under one the reader counts the act, under the other it never does. -/
theorem suspension_splits [Countable R] {suspends : R → R → Prop} {a x : R} (hx : suspends x a)
    (ha : ¬ suspends a a) :
    ∃ (N : LogNet Unit (Option (Option R))) (σ τ : ℕ → LogNet.Ev Unit (Option (Option R))),
      (∀ n, N.Out () (N.logs σ n ()) = askOut (valid suspends a) (N.logs σ n ())) ∧
      (∀ n, N.Out () (N.logs τ n ()) = askOut (valid suspends a) (N.logs τ n ())) ∧
      N.Fair σ ∧ N.Fair τ ∧ (∃ n, none ∈ (N.run σ n ()).2) ∧ ∀ n, none ∉ (N.run τ n ()).2 := by
  refine absence_splits (X := {a}) (Y := insert x {a}) (Set.subset_insert _ _)
    (((Set.finite_singleton a).insert x).subset Set.sdiff_subset)
    ⟨Set.mem_singleton a, fun r hr => ?_⟩ fun h => h.2 x (Set.mem_insert _ _) hx
  rw [Set.mem_singleton_iff.mp hr]
  exact ha

end Cosys.Social
