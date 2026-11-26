import CosysCalco.Claims
import CosysSocial.Grounding

/-!
# Seals

The sections *Seals*, *Sealing together* and *What a signature can vouch for* of *What Absence
Costs*, and objections D5 and D8, as claim types of *Collaboration Is Composition*
(`CosysCalco.Claims`).

A seal is a record of a claim kind that names the records it declares complete for a question. An
absence condition read through a seal holds once the log holds a seal that inhabits its claim type
and the condition holds of the records it names. That fact only grows with the log as long as the
seal's authority rule never asks for more as the log grows (`sealed_positive`): coordination was
spent once, at the seal. "The latest seal" asks for an absence again (`latest_asks_absence`), so a
seal settles the question as of that seal.

A joint seal needs every party's signature, so no party seals or reopens alone (`joint_needs_each`,
`reopen_needs_each`). An observer's checkpoint grounds what the observer saw and cannot stand for a
frame's seal that names another party (`checkpoint_not_institutional`). Validity asks for the
absence of a revocation, and validity as of a signed revocation list does not (`valid_asks_absence`,
`valid_asOf_positive`). A seal made by an office whose grant can be suspended asks for an absence,
and is positive again as of a sealed checkpoint of grants (`office_seal_asks_absence`,
`office_seal_asOf_positive`).
-/

namespace Cosys.Social

open Cosys.Calco

variable {R Role Key K U : Type}

/-- A kind of *seal*: a claim kind whose records each name the records they declare complete. -/
structure SealKind (R Role Key K : Type) extends ClaimKind R Role Key K where
  /-- The records a seal declares complete for its question. -/
  named : R → Set R

variable (S : Signed R Role Key K U)

/-- The absence condition `A`, read through a seal: the log holds a seal for `q` that inhabits its
claim type, and `A` holds of the records it names. -/
def sealed (C : SealKind R Role Key K) (q : C.Param) (A : Grounding R) : Grounding R :=
  fun L => ∃ s ∈ Claim S C.toClaimKind q L, A (C.named s)

/-- **A seal makes an absence fact grow with the log.** Whatever `A` asks for, the sealed fact only
grows with the log, as long as the seal's authority rule never asks for more as the log grows. -/
theorem sealed_positive (C : SealKind R Role Key K) (q : C.Param) (A : Grounding R)
    (hauth : Antitone (C.auth q)) : Positive (sealed S C q A) := by
  rintro L L' h ⟨s, hs, hA⟩
  exact ⟨s, claim_mono C.toClaimKind q hauth h hs, hA⟩

/-- `s` is the latest seal for `q`: it inhabits the claim type, and no seal in the log is later. -/
def latestSeal (C : SealKind R Role Key K) (q : C.Param) (later : R → R → Prop) (s : R) :
    Grounding R :=
  fun L => s ∈ Claim S C.toClaimKind q L ∧ ∀ s' ∈ Claim S C.toClaimKind q L, ¬ later s' s

/-- **"The latest seal" asks for an absence** whenever a later seal can be written: if `s` is the
latest seal in `L`, and a seal `s'` later than it would inhabit the claim type once added, then
"`s` is the latest seal" holds of `L` and fails of `L` with `s'`. -/
theorem latest_asks_absence (C : SealKind R Role Key K) (q : C.Param) (later : R → R → Prop)
    {s s' : R} {L : Set R} (hL : latestSeal S C q later s L) (hlater : later s' s)
    (hs' : s' ∈ Claim S C.toClaimKind q (insert s' L)) :
    AsksAbsence (latestSeal S C q later s) := by
  exact ⟨L, insert s' L, Set.subset_insert _ _, hL, fun h => h.2 s' hs' hlater⟩

/-- *Valid*: in the log, and no revocation of it is. -/
def valid (revokes : R → R → Prop) (c : R) : Grounding R :=
  fun L => c ∈ L ∧ ∀ r ∈ L, ¬ revokes r c

/-- **Validity asks for an absence**, the absence of a revocation. -/
theorem valid_asks_absence {revokes : R → R → Prop} {c r : R} (hr : revokes r c)
    (hc : ¬ revokes c c) : AsksAbsence (valid revokes c) := by
  refine ⟨{c}, insert r {c}, Set.subset_insert _ _, ⟨Set.mem_singleton c, fun x hx => ?_⟩,
    fun h => h.2 r (Set.mem_insert _ _) hr⟩
  rw [Set.mem_singleton_iff.mp hx]
  exact hc

/-- **Valid as of a signed revocation list grows with the log**: the condition that the list names
no revocation of `c`, read through the list's seal. -/
theorem valid_asOf_positive (C : SealKind R Role Key K) (q : C.Param)
    (hauth : Antitone (C.auth q)) (revokes : R → R → Prop) (c : R) :
    Positive (sealed S C q fun X => ∀ r ∈ X, ¬ revokes r c) := by
  exact sealed_positive S C q _ hauth

/-- The authority rule of a joint seal: every party's signature, each in its role. -/
def joint (parties : Set Key) (role : Key → Role) : Set (Role × Key) :=
  (fun k => (role k, k)) '' parties

/-- A joint rule never asks for more as the log grows, so a joint seal makes its fact grow with the
log. -/
theorem joint_positive (C : SealKind R Role Key K) {parties : Set Key} {role : Key → Role}
    (hC : ∀ q L, C.auth q L = joint parties role) (q : C.Param) (A : Grounding R) :
    Positive (sealed S C q A) := by
  refine sealed_positive S C q A fun L L' _ => ?_
  rw [hC q L, hC q L']

/-- **No party alone seals.** If the rule is joint and one of its parties signed nothing in the log,
there is no seal. -/
theorem joint_needs_each (C : SealKind R Role Key K) {parties : Set Key} {role : Key → Role}
    (hC : ∀ q L, C.auth q L = joint parties role) {k : Key} (hk : k ∈ parties) {L : Set R}
    (hsilent : ∀ s ∈ L, S.author s ≠ k) (q : C.Param) : Claim S C.toClaimKind q L = ∅ := by
  exact claim_empty_of_unsigned C.toClaimKind q L (ρ := role k) (by rw [hC]; exact ⟨k, hk, rfl⟩)
    hsilent

/-- **No party alone reopens.** A reopening is one more record, of a kind whose rule is the seal's
joint rule, so it needs the same parties: if one of them signed nothing, there is no reopening. -/
theorem reopen_needs_each (O : ClaimKind R Role Key K) {parties : Set Key} {role : Key → Role}
    (hO : ∀ q L, O.auth q L = joint parties role) {k : Key} (hk : k ∈ parties) {L : Set R}
    (hsilent : ∀ s ∈ L, S.author s ≠ k) (q : O.Param) : Claim S O q L = ∅ := by
  exact claim_empty_of_unsigned O q L (ρ := role k) (by rw [hO]; exact ⟨k, hk, rfl⟩) hsilent

/-- **An observer's checkpoint settles what it saw.** A checkpoint is a seal whose rule asks for the
observer's own signature alone, so the fact it seals grows with the log. -/
theorem checkpoint_positive (C : SealKind R Role Key K) {obs : Key} {role : Role}
    (hC : ∀ q L, C.auth q L = {(role, obs)}) (q : C.Param) (A : Grounding R) :
    Positive (sealed S C q A) := by
  refine sealed_positive S C q A fun L L' _ => ?_
  rw [hC q L, hC q L']

/-- **A checkpoint is not the institution's seal.** If the frame's closing rule is joint and names a
party other than the observer, no log of records the observer alone signed holds a seal of the
frame. -/
theorem checkpoint_not_institutional (C : SealKind R Role Key K) {parties : Set Key}
    {role : Key → Role} (hC : ∀ q L, C.auth q L = joint parties role) {obs p : Key}
    (hp : p ∈ parties) (hpo : p ≠ obs) {L : Set R} (hL : ∀ s ∈ L, S.author s = obs)
    (q : C.Param) : Claim S C.toClaimKind q L = ∅ := by
  exact claim_empty_of_unsigned C.toClaimKind q L (ρ := role p) (by rw [hC]; exact ⟨p, hp, rfl⟩)
    fun s hs h => hpo (h.symm.trans (hL s hs))

/-- The rule of a seal made by an office: the office-holder's signature in its role, and every
signature there is once a suspension of the grant is in the log. -/
def officeRule (holder : Role × Key) (suspends : R → Prop) (L : Set R) : Set (Role × Key) :=
  open Classical in if ∃ s ∈ L, suspends s then Set.univ else {holder}

/-- **A seal by an office asks for an absence**, the absence of a suspension of the grant: if the
office-holder sealed `A` in `L`, and a suspension `x` added to the log leaves some signature unmade,
the sealed fact holds of `L` and fails of `L` with `x`. -/
theorem office_seal_asks_absence (C : SealKind R Role Key K) {holder : Role × Key}
    {suspends : R → Prop} (hC : ∀ q L, C.auth q L = officeRule holder suspends L) (q : C.Param)
    (A : Grounding R) {L : Set R} (hL : sealed S C q A L) {x : R} (hx : suspends x)
    {ρ : Role} {k : Key} (hk : ∀ s ∈ insert x L, S.author s ≠ k) :
    AsksAbsence (sealed S C q A) := by
  refine ⟨L, insert x L, Set.subset_insert _ _, hL, ?_⟩
  rintro ⟨s, hs, -⟩
  have hreq : (ρ, k) ∈ C.auth q (insert x L) := by
    rw [hC]
    unfold officeRule
    split_ifs with h
    · exact Set.mem_univ _
    · exact (h ⟨x, Set.mem_insert x L, hx⟩).elim
  rw [claim_empty_of_unsigned C.toClaimKind q _ hreq hk] at hs
  exact hs

/-- **A seal by an office, as of a sealed checkpoint of grants, grows with the log.** When the rule
reads suspensions from a checkpoint `ck` sealed beforehand, it no longer reads the log. -/
theorem office_seal_asOf_positive (C : SealKind R Role Key K) {holder : Role × Key}
    {suspends : R → Prop} {ck : Set R} (hC : ∀ q L, C.auth q L = officeRule holder suspends ck)
    (q : C.Param) (A : Grounding R) : Positive (sealed S C q A) := by
  refine sealed_positive S C q A fun L L' _ => ?_
  rw [hC q L, hC q L']

end Cosys.Social
