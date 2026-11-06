import Mathlib.Logic.Function.Basic
import Mathlib.Data.Set.Basic

/-!
# Boxes, collaborations and congruence

The definitions *Box*, *Mailbox* and *Collaboration*, and the theorem *Congruence* of *Collaboration
Without Orchestration*.

A box is a Mealy machine whose inputs are records and whose outputs are finite lists of records. In
a collaboration each pair of units has a mailbox, a set of deposited records. A schedule is a
stream of events: a record arriving from outside at one unit, or a record collected from one
mailbox and handed to its recipient's box. The collaboration is then one Mealy machine whose inputs
are events, and two bisimilar families of boxes give bisimilar collaborations. Since a schedule is
an input stream, this covers every schedule at once, including the case where the schedule varies.
-/

namespace Cosys.Calco

open Classical

/-- A Mealy machine with inputs `I` and outputs `O`. -/
structure Mealy (I O : Type) where
  S : Type
  δ : S → I → S
  out : S → I → O
  init : S

namespace Mealy

variable {I O : Type}

/-- The state after reading the first `n` inputs of `xs`. -/
def run (A : Mealy I O) (xs : ℕ → I) : ℕ → A.S
  | 0 => A.init
  | n + 1 => A.δ (run A xs n) (xs n)

/-- The output at step `n` on the input stream `xs`. -/
def trace (A : Mealy I O) (xs : ℕ → I) (n : ℕ) : O := A.out (A.run xs n) (xs n)

/-- `ρ` is a bisimulation: related states give equal outputs and move to related states. -/
def IsBisim (A B : Mealy I O) (ρ : A.S → B.S → Prop) : Prop :=
  ∀ s t, ρ s t → ∀ i, A.out s i = B.out t i ∧ ρ (A.δ s i) (B.δ t i)

/-- Two machines are bisimilar when a bisimulation relates their initial states. -/
def Bisimilar (A B : Mealy I O) : Prop :=
  ∃ ρ, IsBisim A B ρ ∧ ρ A.init B.init

/-- Bisimilar machines give the same outputs on every input stream. -/
theorem Bisimilar.trace_eq {A B : Mealy I O} (h : Bisimilar A B) (xs : ℕ → I) :
    A.trace xs = B.trace xs := by
  obtain ⟨ρ, hρ, hinit⟩ := h
  have hrun : ∀ n, ρ (A.run xs n) (B.run xs n) := by
    intro n
    induction n with
    | zero => exact hinit
    | succ n ih => exact (hρ _ _ ih (xs n)).2
  funext n
  exact (hρ _ _ (hrun n) (xs n)).1

end Mealy

variable {ι R : Type}

/-- A box: a Mealy machine from records to finite lists of records (the definition *Box*). -/
abbrev Box (R : Type) := Mealy R (List R)

/-- The fixed wiring of a collaboration `C(W, P)`: `P u v` says the pairing in which `u` shares with
`v` stands, and `aud r v` that the audience of `r` includes `v`. -/
structure Wiring (ι R : Type) where
  P : ι → ι → Prop
  aud : R → ι → Prop

/-- What a schedule does at one step. -/
inductive Event (ι R : Type) where
  /-- A record arrives at unit `v` from outside, such as a reading a person enters. -/
  | input (v : ι) (r : R)
  /-- The record `r` is collected from the mailbox from `u` to `v` and handed to `v`'s box. -/
  | deliver (u v : ι) (r : R)

namespace Wiring

variable (N : Wiring ι R)

/-- The mailboxes after unit `v` emits `outs`: each record goes into the mailbox from `v` to every
unit `w` that is in its audience and that `v` is paired with. -/
def deposit (m : ι → ι → Set R) (v : ι) (outs : List R) : ι → ι → Set R :=
  fun a b => m a b ∪ {o | a = v ∧ N.P v b ∧ N.aud o b ∧ o ∈ outs}

/-- The collaboration `C(W, P)` as one Mealy machine whose inputs are events. A state is a state
of every box and the contents of every mailbox. A delivery of a record that is not in its mailbox
does nothing. -/
noncomputable def collab (B : ι → Box R) : Mealy (Event ι R) (List R) where
  S := ((i : ι) → (B i).S) × (ι → ι → Set R)
  δ x e := match e with
    | .input v r =>
      (Function.update x.1 v ((B v).δ (x.1 v) r), N.deposit x.2 v ((B v).out (x.1 v) r))
    | .deliver u v r =>
      if r ∈ x.2 u v then
        (Function.update x.1 v ((B v).δ (x.1 v) r),
          N.deposit (Function.update x.2 u (Function.update (x.2 u) v (x.2 u v \ {r}))) v
            ((B v).out (x.1 v) r))
      else x
  out x e := match e with
    | .input v r => (B v).out (x.1 v) r
    | .deliver u v r => if r ∈ x.2 u v then (B v).out (x.1 v) r else []
  init := (fun i => (B i).init, fun _ _ => ∅)

end Wiring

/-- **Congruence.** If each unit's box is bisimilar to another, the collaborations built from the
two families are bisimilar. -/
theorem congruence (N : Wiring ι R) (B B' : ι → Box R) (h : ∀ i, Mealy.Bisimilar (B i) (B' i)) :
    Mealy.Bisimilar (N.collab B) (N.collab B') := by
  choose ρ hρ hinit using h
  refine ⟨fun x y => (∀ i, ρ i (x.1 i) (y.1 i)) ∧ x.2 = y.2, ?_, fun i => hinit i, rfl⟩
  have upd : ∀ (x : (i : ι) → (B i).S) (y : (i : ι) → (B' i).S) (v : ι) (r : R),
      (∀ i, ρ i (x i) (y i)) → ∀ i,
        ρ i (Function.update x v ((B v).δ (x v) r) i)
          (Function.update y v ((B' v).δ (y v) r) i) := by
    intro x y v r hs i
    rcases eq_or_ne i v with rfl | hne
    · simp only [Function.update_self]
      exact ((hρ i) _ _ (hs i) r).2
    · simp only [Function.update_of_ne hne]
      exact hs i
  rintro ⟨x, m⟩ ⟨y, m'⟩ ⟨hs, hm⟩ e
  simp only at hs hm
  subst hm
  cases e with
  | input v r =>
    have ho := ((hρ v) _ _ (hs v) r).1
    simp only [Wiring.collab]
    exact ⟨ho, upd x y v r hs, by rw [ho]⟩
  | deliver u v r =>
    have ho := ((hρ v) _ _ (hs v) r).1
    by_cases hr : r ∈ m u v
    · simp only [Wiring.collab, ite_eq_left hr]
      exact ⟨ho, upd x y v r hs, by rw [ho]⟩
    · simp only [Wiring.collab, ite_eq_right hr]
      exact ⟨trivial, hs, trivial⟩

/-- **Congruence**, for one schedule: on every schedule the two collaborations emit the same records
at every step. -/
theorem congruence_trace (N : Wiring ι R) (B B' : ι → Box R)
    (h : ∀ i, Mealy.Bisimilar (B i) (B' i)) (σ : ℕ → Event ι R) :
    (N.collab B).trace σ = (N.collab B').trace σ :=
  (congruence N B B' h).trace_eq σ

/-! ## Append-only and log-determined boxes -/

/-- A box is append-only with log `lg` when each step adds the input and the outputs to the log
(the definition *Box*). -/
def AppendOnly (B : Box R) (lg : B.S → Set R) : Prop :=
  ∀ s r, lg (B.δ s r) = lg s ∪ {r} ∪ {o | o ∈ B.out s r}

/-- The states a box reaches from its initial state. -/
inductive Reachable (B : Box R) : B.S → Prop
  | init : Reachable B B.init
  | step {s : B.S} (r : R) : Reachable B s → Reachable B (B.δ s r)

/-- A box is log-determined when every state it reaches is a function of its log. -/
def LogDetermined (B : Box R) (lg : B.S → Set R) : Prop :=
  ∃ Φ : Set R → B.S, ∀ s, Reachable B s → s = Φ (lg s)

end Cosys.Calco
