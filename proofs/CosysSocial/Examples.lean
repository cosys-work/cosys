import CosysSocial.Seal
import CosysSocial.Layers

/-!
# The examples of *What Absence Costs*

Small instances of the paper's cases over `Fin` types: the committee, the night nurse, the camera and
the duelling administrators. Where a statement is about particular records it is decided by `decide`,
as `claim_decide_example` is in `CosysCalco.Claims`; where it is about every log it follows from the
library's theorems.
-/

namespace Cosys.Social.Examples

open Cosys.Calco

/-! ## The committee -/

/-- The committee's records: `0`, `1` and `2` are the endorsements Hari, Maya and Bishnu signed, `3`
is an objection, and `4` is the chair's call. -/
abbrev Committee := Fin 5

/-- "The proposal has three endorsements." -/
def threeEndorsements : Grounding Committee := fun X => (0 : Committee) ∈ X ∧ 1 ∈ X ∧ 2 ∈ X

/-- Three endorsements ask only for records. -/
theorem threeEndorsements_positive : Positive threeEndorsements := by
  rintro X Y h ⟨h0, h1, h2⟩
  exact ⟨h h0, h h1, h h2⟩

/-- "No objection remains open." -/
def noObjectionOpen : Grounding Committee := fun X => (3 : Committee) ∉ X

/-- No objection open asks for an absence. -/
theorem noObjectionOpen_asks_absence : AsksAbsence noObjectionOpen := by
  exact ⟨∅, {3}, Set.empty_subset _, fun h => h, fun h => h (Set.mem_singleton 3)⟩

/-- Who signs the committee's records: the members `0`, `1` and `2` endorse, the member `3` objects,
and the chair, key `4`, makes the call. Every key is a person's. -/
def committeeSigned : Signed Committee Unit (Fin 5) Unit Unit where
  author r := r
  kind _ := ()
  authorRole _ := ()
  cosign _ := none
  isAgent _ := False
  operatedBy _ := none
  holds _ _ := False

/-- The chair's call: a seal that needs the chair's signature alone and names the endorsements. -/
def chairsCall : SealKind Committee Unit (Fin 5) Unit where
  kind := ()
  Param := Unit
  names r _ := r = 4
  auth _ _ := {((), 4)}
  named _ := {0, 1, 2}

/-- **The motion carried as of the call** asks only for records: the call seals the question, and
nothing added afterwards takes the decision away. -/
theorem carried_asOf_call_positive :
    Positive (sealed committeeSigned chairsCall () fun X => threeEndorsements X) := by
  exact sealed_positive _ _ _ _ fun _ _ _ => le_rfl

/-- The call inhabits its claim type once it is in the log, and an objection added afterwards
changes nothing about the decision as of the call. -/
theorem carried_asOf_call :
    sealed committeeSigned chairsCall () (fun X => threeEndorsements X) {0, 1, 2, 4} ∧
      sealed committeeSigned chairsCall () (fun X => threeEndorsements X) {0, 1, 2, 3, 4} := by
  have h : ∀ L : Set Committee, 4 ∈ L →
      sealed committeeSigned chairsCall () (fun X => threeEndorsements X) L := by
    intro L hL
    refine ⟨4, ⟨hL, Or.inl fun h => h, rfl, rfl, fun g hg => Or.inl hg⟩, ?_⟩
    simp [threeEndorsements, chairsCall]
  exact ⟨h _ (by simp), h _ (by simp)⟩

/-! ## The night nurse -/

/-- The clinic's records: `0` is the prescription of ten units, `1` a later prescription the day
doctor signed, `2` the handover the day doctor and the night nurse sign together. -/
abbrev Ward := Fin 3

/-- `1` supersedes `0`. -/
def supersedes (r r' : Ward) : Prop := r = 1 ∧ r' = 0

/-- "The current dose is ten units": the prescription is in, and nothing supersedes it. -/
def currentDoseTen : Grounding Ward := valid supersedes 0

/-- The current dose asks for an absence, the absence of a later prescription. -/
theorem currentDoseTen_asks_absence : AsksAbsence currentDoseTen := by
  exact valid_asks_absence (r := 1) ⟨rfl, rfl⟩ fun h => absurd h.1 (by decide)

/-- Who signs on the ward: the day doctor, key `0`, signs the prescriptions, and the handover is the
night nurse's, key `1`, co-signed by the day doctor. -/
def wardSigned : Signed Ward Bool (Fin 2) Unit Unit where
  author r := if r = 2 then 1 else 0
  kind _ := ()
  authorRole r := if r = 2 then true else false
  cosign _ := none
  isAgent _ := False
  operatedBy _ := none
  holds _ _ := False

/-- The handover: a joint seal of the day doctor and the night nurse, naming the prescriptions the
dose is computed from. -/
def handover : SealKind Ward Bool (Fin 2) Unit where
  kind := ()
  Param := Unit
  names r _ := r = 2
  auth _ _ := joint Set.univ fun k => k = 1
  named _ := {0}

/-- **The dose as of the handover** asks only for records. -/
theorem dose_asOf_handover_positive :
    Positive (sealed wardSigned handover () fun X => ∀ r ∈ X, ¬ supersedes r 0) := by
  exact joint_positive wardSigned handover (fun _ _ => rfl) () _

/-- The night nurse's checkpoint: a seal she signs alone, as the observer, naming what has reached
her. -/
def nurseCheckpoint : SealKind Ward Bool (Fin 2) Unit where
  kind := ()
  Param := Unit
  names r _ := r = 2
  auth _ _ := {(true, 1)}
  named _ := {0}

/-- **"No later prescription has reached me" is a checkpoint and asks only for records.** -/
theorem nurse_checkpoint_positive :
    Positive (sealed wardSigned nurseCheckpoint () fun X => ∀ r ∈ X, ¬ supersedes r 0) := by
  exact checkpoint_positive wardSigned nurseCheckpoint (fun _ _ => rfl) () _

/-- **No handover without both.** In a log where the day doctor signed nothing, there is no
handover. -/
theorem no_handover_alone {L : Set Ward} (h : ∀ s ∈ L, wardSigned.author s ≠ 0) :
    Claim wardSigned handover.toClaimKind () L = ∅ := by
  exact joint_needs_each wardSigned handover (fun _ _ => rfl) (Set.mem_univ 0) h ()

/-! ## The camera -/

/-- The camera's records: `0` is a credential, `1` its revocation, and `2` a signed revocation list
of the issuer. -/
abbrev Camera := Fin 3

/-- `1` revokes `0`. -/
def revokesCredential (r r' : Camera) : Prop := r = 1 ∧ r' = 0

/-- "The credential is valid" asks for an absence. -/
theorem credential_valid_asks_absence : AsksAbsence (valid revokesCredential 0) := by
  exact valid_asks_absence (r := 1) ⟨rfl, rfl⟩ fun h => absurd h.1 (by decide)

/-- Who signs for the camera: the camera, key `0`, signs the credential, and the issuer, key `1`,
signs the revocation and the list. -/
def cameraSigned : Signed Camera Unit (Fin 2) Unit Unit where
  author r := if r = 0 then 0 else 1
  kind _ := ()
  authorRole _ := ()
  cosign _ := none
  isAgent _ := False
  operatedBy _ := none
  holds _ _ := False

/-- The issuer's signed revocation list: a seal by the issuer naming the revocations it lists. -/
def revocationList : SealKind Camera Unit (Fin 2) Unit where
  kind := ()
  Param := Unit
  names r _ := r = 2
  auth _ _ := {((), 1)}
  named _ := ∅

/-- **"Valid as of the signed revocation list" asks only for records.** -/
theorem credential_valid_asOf_list_positive :
    Positive (sealed cameraSigned revocationList () fun X => ∀ r ∈ X, ¬ revokesCredential r 0) :=
  valid_asOf_positive cameraSigned revocationList () (fun _ _ _ => le_rfl) revokesCredential 0

/-! ## The duelling administrators -/

/-- A revocation of one administrator by another, at the time its author claims. -/
structure Revocation where
  by_ : Fin 2
  target : Fin 2
  claimed : ℕ
  deriving DecidableEq

/-- Seniority breaks ties: administrator `0` is senior. -/
def senior (a : Fin 2) : ℕ := if a = 0 then 1 else 0

/-- Of two mutual revocations, the one with the earlier claimed time prevails, and seniority breaks a
tie. The administrator who remains is the author of the revocation that prevails. -/
def remains (r r' : Revocation) : Fin 2 :=
  if r.claimed < r'.claimed then r.by_
  else if r'.claimed < r.claimed then r'.by_
  else if senior r.by_ ≥ senior r'.by_ then r.by_ else r'.by_

/-- Administrator `0` revokes `1` at time 5. -/
def first : Revocation := ⟨0, 1, 5⟩
/-- Administrator `1`, already revoked, revokes `0` honestly at time 7. -/
def honest : Revocation := ⟨1, 0, 7⟩
/-- The same revocation by `1`, backdated to time 3. -/
def backdated : Revocation := ⟨1, 0, 3⟩

/-- **Backdating changes the outcome** under a tie-break over claimed times. -/
theorem backdate_changes_outcome : remains first honest ≠ remains first backdated := by
  decide

/-- A log of revocations and at most one epoch seal, which names the revocations it orders, in
order. -/
structure EpochLog where
  revocations : List Revocation
  epoch : Option (List Revocation)

/-- The order the log gives the revocations: the order the epoch seal fixed, or, with no seal, the
order of their claimed times. -/
def EpochLog.order (L : EpochLog) : List Revocation :=
  match L.epoch with
  | some fixed => fixed
  | none => L.revocations.insertionSort fun a b => a.claimed ≤ b.claimed

/-- Adding a revocation to the log, whatever time it claims. -/
def EpochLog.add (L : EpochLog) (r : Revocation) : EpochLog :=
  { L with revocations := r :: L.revocations }

/-- With no epoch seal, a backdated revocation added later goes to the front of the order. -/
theorem backdate_reorders :
    (EpochLog.add ⟨[first], none⟩ backdated).order.head? = some backdated := by
  decide

/-- **An epoch seal takes the profit out of backdating.** Once the epoch is sealed, no revocation
added afterwards changes the order it fixed, whatever time it claims. -/
theorem epoch_fixes_order (L : EpochLog) (hL : L.epoch.isSome) (r : Revocation) :
    (L.add r).order = L.order := by
  obtain ⟨fixed, h⟩ := Option.isSome_iff_exists.mp hL
  simp [EpochLog.order, EpochLog.add, h]

end Cosys.Social.Examples
