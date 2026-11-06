import Mathlib.Data.Set.Finite.Basic
import Mathlib.Data.Finset.Prod

/-!
# Claims as types

The definitions *Grade of a record*, *Claim type* and *Placement of an agent*, the proposition on
claim types, the proposition *Agents draft, people sign*, and the lemma *Placement changes routing
only* of *Collaboration Without Orchestration*.

A record has an author key and a kind. A co-signature is a record of its own, which signs another
record in a role with its author's key. Keys are held by persons or by agents. A signature by an
agent key counts only when the log holds an `operated_by` record for that key naming a unit a
person holds; we call such a key accountable in the log, and every person key is. The grade of a
record in a log is the set of role and key pairs that have signed it there with accountable keys.
A claim kind has parameters, a naming relation and an authority rule, the signatures the claim
needs, which may read pairing records in the log. A record of the log inhabits the claim type when
its author is accountable, it has the kind, names the parameters, and its grade covers the
authority rule.
-/

namespace Cosys.Calco

variable {R Role Key K U : Type}

/-- Who signed what, and who answers for agent keys. -/
structure Signed (R Role Key K U : Type) where
  author : R → Key
  kind : R → K
  /-- The role in which an author signs its own record. -/
  authorRole : Role
  /-- `cosign s = some (r, ρ)`: the record `s` is a co-signature of `r` in the role `ρ`. A
  co-signature names one subject and one role. -/
  cosign : R → Option (R × Role)
  /-- Keys held by agents; every other key is held by a person. -/
  isAgent : Key → Prop
  /-- `operatedBy s = some (k, u)`: the record `s` says the agent key `k` is operated by the unit
  `u`. -/
  operatedBy : R → Option (Key × U)
  /-- Units a person holds. -/
  personHeld : U → Prop

/-- A claim kind. -/
structure ClaimKind (R Role Key K : Type) where
  kind : K
  Param : Type
  /-- `names r x`: the record `r` names the parameters `x` in the kind's roles. -/
  names : R → Param → Prop
  /-- The authority rule: the signatures a claim with parameters `x` needs in the log `L`. -/
  auth : Param → Set R → Set (Role × Key)

variable (S : Signed R Role Key K U)

/-- A key is accountable in `L` when a person holds it, or when `L` holds an `operated_by` record
for it naming a unit a person holds. -/
def Accountable (L : Set R) (k : Key) : Prop :=
  ¬ S.isAgent k ∨ ∃ s ∈ L, ∃ u, S.operatedBy s = some (k, u) ∧ S.personHeld u

/-- The grade of `r` in the log `L`: its author in the author's role, and every co-signer, with an
accountable key, in its role. -/
def grade (L : Set R) (r : R) : Set (Role × Key) :=
  {(S.authorRole, S.author r)} ∪
    {g | ∃ s ∈ L, S.cosign s = some (r, g.1) ∧ S.author s = g.2 ∧ Accountable S L g.2}

/-- The claim type `Claim κ (x) L`. -/
def Claim (C : ClaimKind R Role Key K) (x : C.Param) (L : Set R) : Set R :=
  {r | r ∈ L ∧ Accountable S L (S.author r) ∧ S.kind r = C.kind ∧ C.names r x ∧
    C.auth x L ⊆ grade S L r}

variable {S}

/-- A key accountable in a log stays accountable as the log grows. -/
theorem Accountable.mono {L L' : Set R} (h : L ⊆ L') {k : Key} (hk : Accountable S L k) :
    Accountable S L' k := by
  rcases hk with hk | ⟨s, hs, u, hop, hp⟩
  · exact Or.inl hk
  · exact Or.inr ⟨s, h hs, u, hop, hp⟩

/-- The grade of a record grows with the log. -/
theorem grade_mono {L L' : Set R} (h : L ⊆ L') (r : R) : grade S L r ⊆ grade S L' r := by
  rintro g (hg | ⟨s, hs, hc, ha, hacc⟩)
  · exact Or.inl hg
  · exact Or.inr ⟨s, h hs, hc, ha, hacc.mono h⟩

/-- `Accountable`, checked against a finite log. -/
def accountableIn (S : Signed R Role Key K U) [DecidableEq Key] [DecidablePred S.personHeld]
    (L : Finset R) (k : Key) : Prop :=
  ¬ S.isAgent k ∨
    ∃ s ∈ L, (S.operatedBy s).any (fun p => decide (p.1 = k) && decide (S.personHeld p.2))

instance (S : Signed R Role Key K U) [DecidableEq Key] [DecidablePred S.isAgent]
    [DecidablePred S.personHeld] (L : Finset R) : DecidablePred (accountableIn S L) := fun k => by
  unfold accountableIn
  infer_instance

theorem accountableIn_iff (S : Signed R Role Key K U) [DecidableEq Key]
    [DecidablePred S.personHeld] (L : Finset R) (k : Key) :
    accountableIn S L k ↔ Accountable S ↑L k := by
  unfold accountableIn Accountable
  apply or_congr Iff.rfl
  simp only [Option.any_eq_true, Bool.and_eq_true, decide_eq_true_eq,
    Finset.mem_coe]
  constructor
  · rintro ⟨s, hs, ⟨k', u⟩, hop, rfl, hp⟩
    exact ⟨s, hs, u, hop, hp⟩
  · rintro ⟨s, hs, u, hop, hp⟩
    exact ⟨s, hs, (k, u), hop, rfl, hp⟩

/-- **Claims as types (i).** For a finite log, with the authority rule computable as a finite set,
whether a record inhabits a claim type is decidable. -/
noncomputable def claimDecidable [DecidableEq R] [DecidableEq Role] [DecidableEq Key]
    [DecidableEq K] [DecidableEq U] [DecidablePred S.isAgent] [DecidablePred S.personHeld]
    (C : ClaimKind R Role Key K) [∀ r x, Decidable (C.names r x)]
    (authF : C.Param → Finset R → Finset (Role × Key))
    (hauth : ∀ x (L : Finset R), ↑(authF x L) = C.auth x ↑L)
    (x : C.Param) (L : Finset R) (r : R) : Decidable (r ∈ Claim S C x ↑L) :=
  decidable_of_iff
    (r ∈ L ∧ accountableIn S L (S.author r) ∧ S.kind r = C.kind ∧ C.names r x ∧
      ∀ g ∈ authF x L, g = (S.authorRole, S.author r) ∨
        ∃ s ∈ L, S.cosign s = some (r, g.1) ∧ S.author s = g.2 ∧ accountableIn S L g.2)
    (by
      simp only [accountableIn_iff]
      constructor
      · rintro ⟨hrL, hacc, hk, hn, hall⟩
        refine ⟨hrL, hacc, hk, hn, fun g hg => ?_⟩
        rw [← hauth] at hg
        rcases hall g hg with h | ⟨s, hs, hc, ha, hacc'⟩
        · exact Or.inl h
        · exact Or.inr ⟨s, hs, hc, ha, hacc'⟩
      · rintro ⟨hrL, hacc, hk, hn, hsub⟩
        refine ⟨hrL, hacc, hk, hn, fun g hg => ?_⟩
        have hg' : g ∈ C.auth x ↑L := by rw [← hauth]; exact hg
        rcases hsub hg' with h | ⟨s, hs, hc, ha, hacc'⟩
        · exact Or.inl h
        · exact Or.inr ⟨s, hs, hc, ha, hacc'⟩)

/-- **Claims as types (ii).** If the authority rule asks for a key that signed nothing in the log,
the claim type is empty. -/
theorem claim_empty_of_unsigned (C : ClaimKind R Role Key K) (x : C.Param) (L : Set R)
    {ρ : Role} {k : Key} (hreq : (ρ, k) ∈ C.auth x L) (hk : ∀ s ∈ L, S.author s ≠ k) :
    Claim S C x L = ∅ := by
  apply Set.eq_empty_of_subset_empty
  rintro r ⟨hrL, -, -, -, hsub⟩
  rcases hsub hreq with hg | ⟨s, hs, -, ha, -⟩
  · exact hk r hrL (Prod.mk.inj (Set.mem_singleton_iff.mp hg)).2.symm
  · exact hk s hs ha

/-- **Claims as types (iii).** If the authority rule never asks for more as the log grows, a claim
type only grows with the log. -/
theorem claim_mono (C : ClaimKind R Role Key K) (x : C.Param) (hauth : Antitone (C.auth x))
    {L L' : Set R} (h : L ⊆ L') : Claim S C x L ⊆ Claim S C x L' := by
  rintro r ⟨hrL, hacc, hk, hn, hsub⟩
  exact ⟨h hrL, hacc.mono h, hk, hn, fun g hg => grade_mono h r (hsub (hauth h hg))⟩

/-! ## Agents draft, people sign -/

/-- **Agents draft, people sign.** Every key that signs a record of a claim type, as its author or
as a counted co-signer, is accountable: a person holds it, or it reaches a unit a person holds by
one `operated_by` record. -/
theorem signers_accountable (C : ClaimKind R Role Key K) (x : C.Param) (L : Set R) (r : R)
    (hr : r ∈ Claim S C x L) :
    Accountable S L (S.author r) ∧ ∀ g ∈ grade S L r, Accountable S L g.2 := by
  obtain ⟨-, hacc, -, -, -⟩ := hr
  refine ⟨hacc, ?_⟩
  rintro g (hg | ⟨s, -, -, -, hacc'⟩)
  · rw [Set.mem_singleton_iff] at hg
    subst hg
    exact hacc
  · exact hacc'

/-- A claim kind is reserved when its authority rule asks for at least one signature, and only for
person keys. -/
def Reserved (S : Signed R Role Key K U) (C : ClaimKind R Role Key K) : Prop :=
  ∀ x L, (C.auth x L).Nonempty ∧ ∀ g ∈ C.auth x L, ¬ S.isAgent g.2

/-- **Agents draft, people sign.** No log whose records are all signed by agent keys inhabits a
reserved claim type. -/
theorem agents_cannot_inhabit (C : ClaimKind R Role Key K) (hres : Reserved S C) (L : Set R)
    (hL : ∀ s ∈ L, S.isAgent (S.author s)) (x : C.Param) : Claim S C x L = ∅ := by
  apply Set.eq_empty_of_subset_empty
  rintro r ⟨hrL, -, -, -, hsub⟩
  obtain ⟨g, hg⟩ := (hres x L).1
  have hpers := (hres x L).2 g hg
  rcases hsub hg with hg' | ⟨s, hs, -, ha, -⟩
  · rw [Set.mem_singleton_iff] at hg'
    subst hg'
    exact hpers (hL r hrL)
  · exact hpers (ha ▸ hL s hs)

/-- **Placement changes routing only.** Moving an agent between placements writes or removes only
directory records, marked `place`: the unit, its mailbox, the role, and the `operated_by` record
naming the unit, held by a person, that answers for the agent. None of them co-signs anything. If
every key is accountable in both logs alike and the authority rule does not read the placement
records, every other record inhabits the same claim types in both logs. -/
theorem placement_routing_only (place : R → Prop) (hcos : ∀ s, S.cosign s ≠ none → ¬ place s)
    {L L' : Set R} (hLL' : ∀ s, ¬ place s → (s ∈ L ↔ s ∈ L'))
    (hacc : ∀ k, Accountable S L k ↔ Accountable S L' k) (C : ClaimKind R Role Key K)
    (hauth : ∀ x, C.auth x L = C.auth x L') (x : C.Param) (r : R) (hr : ¬ place r) :
    r ∈ Claim S C x L ↔ r ∈ Claim S C x L' := by
  have hnp : ∀ s ρ, S.cosign s = some (r, ρ) → ¬ place s := fun s ρ hc =>
    hcos s (by rw [hc]; exact Option.some_ne_none _)
  have hgrade : grade S L r = grade S L' r := by
    ext g
    constructor
    · rintro (hg | ⟨s, hs, hc, ha, hacc'⟩)
      · exact Or.inl hg
      · exact Or.inr ⟨s, (hLL' s (hnp s g.1 hc)).mp hs, hc, ha, (hacc g.2).mp hacc'⟩
    · rintro (hg | ⟨s, hs, hc, ha, hacc'⟩)
      · exact Or.inl hg
      · exact Or.inr ⟨s, (hLL' s (hnp s g.1 hc)).mpr hs, hc, ha, (hacc g.2).mpr hacc'⟩
  constructor
  · rintro ⟨hrL, hacc', hk, hn, hsub⟩
    exact ⟨(hLL' r hr).mp hrL, (hacc _).mp hacc', hk, hn, by rw [← hauth, ← hgrade]; exact hsub⟩
  · rintro ⟨hrL, hacc', hk, hn, hsub⟩
    exact ⟨(hLL' r hr).mpr hrL, (hacc _).mpr hacc', hk, hn, by rw [hauth, hgrade]; exact hsub⟩

end Cosys.Calco
