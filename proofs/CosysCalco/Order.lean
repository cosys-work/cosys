import Mathlib.Order.FixedPoints
import Mathlib.Order.OmegaCompletePartialOrder
import Mathlib.Data.Set.Finite.Basic
import Mathlib.Basic.Countable.Basic
import Mathlib.Data.Set.Card
import Mathlib.Data.Set.Finite.Range
import Mathlib.Data.Set.Finite.Lattice

/-!
# Order independence

The definition *Monotone box*, the theorem *Order independence*, the propositions on global
quiescence, on non-monotone conditions and on growing wiring, and the proposition *Rounds are a
fair schedule* of *Collaboration Without Orchestration*.

A monotone box is log-determined, so we read it at the level of logs. `Out L` is the set of records
the box has emitted once its log is `L`. On an input `r` at log `L` the box emits what
`Out (L ∪ {r})` adds, and its log becomes `L ∪ {r} ∪ Out (L ∪ {r})`. This is the receive rule of
the definition. A box starts from its initial log having emitted nothing, so `Out` of an initial
log is empty. `recv_fold` shows that such a box reaches the same state whatever order it reads a
set of records in, and `recv_dup` that reading a record twice changes nothing.

Records reach a unit from other units, through mailboxes, and from outside: the records a person in
the unit enters and the records of a pairing ceremony. `In u` is the set of outside inputs of `u`.
The pairing in which `w` shares with `u` is read from `w`'s own log, as in the definition
*Collaboration with changing wiring*. A record emitted by `w` sits in the mailbox from `w` to `u`
while that pairing stands and `u` is in its audience. Collecting it does not remove it, so a
schedule may deliver it more than once. A schedule is fair when every record that is ever waiting
in a mailbox is collected at some step while it waits.

With finitely many records that can be input or emitted there are two scenarios. With finitely many
units, every fair schedule reaches the least fixed point and the network falls quiet there. With
unboundedly many units, every unit's log still settles on its part of the least fixed point, but
the network as a whole may never fall quiet (`no_global_quiescence`). With unboundedly many
records, the union of the logs along a fair schedule is the least fixed point when each `Out` is
read on infinite sets through its finite subsets (`finitary`).

The side conditions are about the logs a run can reach. Finiteness is asked of the outside inputs
and of what `Out` emits inside the least fixed point. Pairings need only be monotone on the logs
that can arise: `within` reads them on a set `Z` that holds every initial log, every outside input
and every emission, such as the records that are not revocations.
-/

namespace Cosys.Calco

open Classical OrderHom OmegaCompletePartialOrder

variable {ι R : Type}

/-- A network of boxes read at the level of logs. -/
structure LogNet (ι R : Type) where
  /-- `aud r u`: the audience of `r` includes `u`. -/
  aud : R → ι → Prop
  /-- `pairs w u L`: in the log `L`, the pairing in which `w` shares with `u` stands. -/
  pairs : ι → ι → Set R → Prop
  /-- What each unit's box has emitted once its log is a given set. -/
  Out : ι → Set R → Set R
  /-- The initial logs. -/
  L0 : ι → Set R
  /-- The outside inputs of each unit. -/
  In : ι → Set R

/-- The definition *Monotone box*: `Out` is monotone, and the box's own emissions add nothing to
what it emits. -/
def MonotoneBox (Out : Set R → Set R) : Prop :=
  Monotone Out ∧ ∀ X, Out (X ∪ Out X) = Out X

namespace LogNet

variable (N : LogNet ι R)

/-- A unit's state: its log and the records it has emitted. -/
abbrev St (ι R : Type) := ι → Set R × Set R

/-- An event of a schedule: collect a record from the mailbox from a source to a unit. The source
`some w` is unit `w`, and `none` is the outside. -/
abbrev Ev (ι R : Type) := Option ι × ι × R

/-- Every box starts from its initial log, having emitted nothing. -/
def init : St ι R := fun u => (N.L0 u, ∅)

/-- The mailbox from a source to `u`. From outside it holds the outside inputs of `u`. -/
def mailbox (x : St ι R) : Option ι → ι → Set R
  | none, u => N.In u
  | some w, u => {r | N.pairs w u (x w).1 ∧ N.aud r u ∧ r ∈ (x w).2}

/-- Unit `u` reads the set `X` of records, one after another (`recv_fold`). -/
def recvSet (u : ι) (p : Set R × Set R) (X : Set R) : Set R × Set R :=
  (p.1 ∪ X ∪ N.Out u (p.1 ∪ X), p.2 ∪ N.Out u (p.1 ∪ X))

/-- Unit `u` receives `r`: the receive rule. -/
def recv (u : ι) (p : Set R × Set R) (r : R) : Set R × Set R :=
  (p.1 ∪ {r} ∪ N.Out u (p.1 ∪ {r}), p.2 ∪ N.Out u (p.1 ∪ {r}))

/-- One step of a schedule: collect `r` from the mailbox from `w` to `u` and hand it to `u`. A
record that is not in that mailbox is not delivered. -/
noncomputable def deliver (x : St ι R) (d : Ev ι R) : St ι R :=
  if d.2.2 ∈ N.mailbox x d.1 d.2.1 then Function.update x d.2.1 (N.recv d.2.1 (x d.2.1) d.2.2)
  else x

/-- The states along a schedule. -/
noncomputable def run (σ : ℕ → Ev ι R) : ℕ → St ι R
  | 0 => N.init
  | n + 1 => N.deliver (run σ n) (σ n)

/-- The logs along a schedule. -/
noncomputable def logs (σ : ℕ → Ev ι R) (n : ℕ) : ι → Set R := fun u => (N.run σ n u).1

/-- A schedule is fair when every record that is ever waiting in a mailbox is collected from it at
some step while it waits. -/
def Fair (σ : ℕ → Ev ι R) : Prop :=
  ∀ n w u r, r ∈ N.mailbox (N.run σ n) w u → ∃ m, σ m = (w, u, r) ∧ r ∈ N.mailbox (N.run σ m) w u

/-- The records a unit starts with or is offered from outside. -/
abbrev base (u : ι) : Set R := N.L0 u ∪ N.In u

/-- The records deliverable to `u` from other units when the units hold the logs `L`. -/
def deliverable (L : ι → Set R) (u : ι) : Set R :=
  {r | ∃ w, N.pairs w u (L w) ∧ N.aud r u ∧ r ∈ N.Out w (L w)}

/-- `F` adds to each log its initial records and outside inputs, the records that can be delivered
to it, and what its box emits. Its least fixed point is the least fixed point above the initial
logs and the outside inputs. -/
def F (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u)) :
    (ι → Set R) →o (ι → Set R) where
  toFun L u := N.base u ∪ N.deliverable L u ∪ N.Out u (L u)
  monotone' := by
    intro L L' h u r hr
    rcases hr with (hr | ⟨w, hw, ha, ho⟩) | hr
    · exact Or.inl (Or.inl hr)
    · exact Or.inl (Or.inr ⟨w, hP w u (h w) hw, ha, hOut w (h w) ho⟩)
    · exact Or.inr (hOut u (h u) hr)

/-- The least fixed point of `F` for a network of monotone boxes. -/
noncomputable abbrev least (hbox : ∀ u, MonotoneBox (N.Out u))
    (hP : ∀ w u, Monotone (N.pairs w u)) : ι → Set R :=
  lfp (N.F (fun u => (hbox u).1) hP)

/-- What reaches `u` in a round: its outside inputs and what can be delivered to it. -/
def incoming (L : ι → Set R) (u : ι) : Set R := N.In u ∪ N.deliverable L u

/-- One round: every unit reads, as one set, everything that reaches it. -/
def roundStep (L : ι → Set R) : ι → Set R := fun u =>
  (L u ∪ N.incoming L u) ∪ N.Out u (L u ∪ N.incoming L u)

/-- The logs after `n` rounds. -/
def rounds : ℕ → ι → Set R
  | 0 => N.L0
  | n + 1 => N.roundStep (rounds n)

/-- `N` with each pairing read on the records of `Z` only. -/
def within (Z : Set R) : LogNet ι R :=
  { N with pairs := fun w u X => N.pairs w u (X ∩ Z) }

end LogNet

/-! ## Lemmas on sets -/

/-- A bounded monotone sequence of natural numbers settles. -/
theorem nat_settles {c : ℕ → ℕ} (hc : Monotone c) {B : ℕ} (hB : ∀ n, c n ≤ B) :
    ∃ n, ∀ m, n ≤ m → c m = c n := by
  by_contra h
  have h' : ∀ n, ∃ m, n ≤ m ∧ c m ≠ c n := fun n => by
    by_contra hn
    exact h ⟨n, fun m hm => by
      by_contra hne
      exact hn ⟨m, hm, hne⟩⟩
  have hk : ∀ k, ∃ n, k ≤ c n := by
    intro k
    induction k with
    | zero => exact ⟨0, Nat.zero_le _⟩
    | succ k ih =>
      obtain ⟨n, hn⟩ := ih
      obtain ⟨m, hm, hne⟩ := h' n
      have := hc hm
      exact ⟨m, by omega⟩
  obtain ⟨n, hn⟩ := hk (B + 1)
  have := hB n
  omega

/-- An increasing sequence of sets that only ever adds elements of a finite set settles. -/
theorem sets_settle {f : ℕ → Set R} (hf : Monotone f) {E : Set R} (hE : E.Finite)
    (hsub : ∀ n, f n ⊆ f 0 ∪ E) : ∃ n, ∀ m, n ≤ m → f m = f n := by
  obtain ⟨n, hn⟩ := nat_settles (c := fun n => (f n ∩ E).ncard)
    (fun a b hab => Set.ncard_le_ncard (Set.inter_subset_inter_left _ (hf hab))
      (hE.subset Set.inter_subset_right))
    (fun n => Set.ncard_le_ncard Set.inter_subset_right hE)
  refine ⟨n, fun m hm => ?_⟩
  have heq : f n ∩ E = f m ∩ E :=
    Set.eq_of_subset_of_ncard_le (Set.inter_subset_inter_left _ (hf hm)) (hn m hm).le
      (hE.subset Set.inter_subset_right)
  apply Set.Subset.antisymm _ (hf hm)
  intro r hr
  rcases hsub m hr with h0 | hr'
  · exact hf (Nat.zero_le n) h0
  · have hrm : r ∈ f m ∩ E := ⟨hr, hr'⟩
    rw [← heq] at hrm
    exact hrm.1

/-- The union of an increasing sequence that has settled is its settled value. -/
theorem union_of_settled {f : ℕ → Set R} (hf : Monotone f) {n : ℕ}
    (hn : ∀ m, n ≤ m → f m = f n) : (⋃ m, f m) = f n := by
  apply Set.Subset.antisymm
  · intro r hr
    obtain ⟨m, hm⟩ := Set.mem_iUnion.mp hr
    rcases le_total m n with h | h
    · exact hf h hm
    · rw [hn m h] at hm
      exact hm
  · exact Set.subset_iUnion f n

/-- A map on sets that preserves unions of increasing chains. -/
theorem cont_iUnion {f : Set R → Set R} (hf : ωScottContinuous f) (c : ℕ → Set R)
    (hc : Monotone c) : f (⋃ n, c n) = ⋃ n, f (c n) := by
  let ch : Chain (Set R) := ⟨c, hc⟩
  have h1 : (⋃ n, c n) = ωSup ch := ωSup_eq_of_isLUB isLUB_iSup
  have h2 : (⋃ n, f (c n)) = ωSup (ch.map ⟨f, hf.monotone⟩) := ωSup_eq_of_isLUB isLUB_iSup
  rw [h1, h2, hf.map_ωSup]

/-- A condition on sets that preserves unions of increasing chains holds at some finite stage. -/
theorem cont_prop {p : Set R → Prop} (hp : ωScottContinuous p) (c : ℕ → Set R)
    (hc : Monotone c) (h : p (⋃ n, c n)) : ∃ n, p (c n) := by
  let ch : Chain (Set R) := ⟨c, hc⟩
  have h1 : (⋃ n, c n) = ωSup ch := ωSup_eq_of_isLUB isLUB_iSup
  have h2 : (⨆ n, p (c n)) = ωSup (ch.map ⟨p, hp.monotone⟩) := ωSup_eq_of_isLUB isLUB_iSup
  rw [h1, hp.map_ωSup, ← h2, iSup_Prop_eq] at h
  exact h

/-- What a monotone box emits once it has read `B` and then `C` is what it emits from reading
both. -/
theorem closure_step {f : Set R → Set R} (hb : MonotoneBox f) (A B C : Set R) :
    f (A ∪ B ∪ f (A ∪ B) ∪ C) = f (A ∪ (B ∪ C)) ∧
      A ∪ B ∪ f (A ∪ B) ∪ C ∪ f (A ∪ (B ∪ C)) = A ∪ (B ∪ C) ∪ f (A ∪ (B ∪ C)) := by
  have hYZ : A ∪ (B ∪ C) ⊆ A ∪ B ∪ f (A ∪ B) ∪ C := by
    rintro x (h | h | h)
    · exact Or.inl (Or.inl (Or.inl h))
    · exact Or.inl (Or.inl (Or.inr h))
    · exact Or.inr h
  have hAB : A ∪ B ⊆ A ∪ (B ∪ C) := Set.union_subset_union_right A Set.subset_union_left
  have hZY : A ∪ B ∪ f (A ∪ B) ∪ C ⊆ A ∪ (B ∪ C) ∪ f (A ∪ (B ∪ C)) := by
    rintro x (((h | h) | h) | h)
    · exact Or.inl (Or.inl h)
    · exact Or.inl (Or.inr (Or.inl h))
    · exact Or.inr (hb.1 hAB h)
    · exact Or.inl (Or.inr (Or.inr h))
  have hf : f (A ∪ B ∪ f (A ∪ B) ∪ C) = f (A ∪ (B ∪ C)) := by
    apply Set.Subset.antisymm
    · have := hb.1 hZY
      rwa [hb.2] at this
    · exact hb.1 hYZ
  refine ⟨hf, ?_⟩
  apply Set.Subset.antisymm
  · exact Set.union_subset hZY Set.subset_union_right
  · exact Set.union_subset (hYZ.trans Set.subset_union_left) Set.subset_union_right

/-! ## Finitary maps

A box's `Out` is given on finite logs. On an infinite set `X` we read it as the union of `Out L`
over the finite `L ⊆ X`. Read this way it is still a monotone box (`finitary_box`), agrees with
`Out` on finite sets (`finitary_eq`), and preserves unions of increasing chains
(`finitary_continuous`), which is what part (iii) of the theorem *Order independence* needs. -/

/-- The finitary extension of a map on sets. -/
def finitary (f : Set R → Set R) (X : Set R) : Set R :=
  {r | ∃ L : Set R, L.Finite ∧ L ⊆ X ∧ r ∈ f L}

theorem finitary_mono (f : Set R → Set R) : Monotone (finitary f) :=
  fun _ _ h _ ⟨L, hL, hLX, hr⟩ => ⟨L, hL, hLX.trans h, hr⟩

theorem finitary_eq {f : Set R → Set R} (hf : Monotone f) {X : Set R} (hX : X.Finite) :
    finitary f X = f X :=
  Set.Subset.antisymm (fun _ ⟨_, _, hLX, hr⟩ => hf hLX hr) fun _ hr => ⟨X, hX, subset_rfl, hr⟩

theorem finitary_le {f : Set R → Set R} (hf : Monotone f) (X : Set R) : finitary f X ⊆ f X :=
  fun _ ⟨_, _, hLX, hr⟩ => hf hLX hr

theorem finitary_continuous (f : Set R → Set R) : ωScottContinuous (finitary f) := by
  refine ωScottContinuous.of_monotone_map_ωSup ⟨finitary_mono f, fun c => ?_⟩
  have h1 : (⋃ n, c n) = ωSup c := ωSup_eq_of_isLUB isLUB_iSup
  have h2 : (⋃ n, finitary f (c n)) = ωSup (c.map ⟨finitary f, finitary_mono f⟩) :=
    ωSup_eq_of_isLUB isLUB_iSup
  rw [← h1, ← h2]
  apply Set.Subset.antisymm
  · rintro r ⟨L, hL, hLX, hr⟩
    obtain ⟨I, hI, hLI⟩ := Set.finite_subset_iUnion hL hLX
    obtain ⟨K, hK⟩ := hI.bddAbove
    refine Set.mem_iUnion.mpr ⟨K, L, hL, fun y hy => ?_, hr⟩
    obtain ⟨i, hi, hy'⟩ := Set.mem_iUnion₂.mp (hLI hy)
    exact c.monotone (hK hi) hy'
  · exact Set.iUnion_subset fun n => finitary_mono f (Set.subset_iUnion (fun n => c n) n)

theorem finitary_box {f : Set R → Set R} (hb : MonotoneBox f) : MonotoneBox (finitary f) := by
  refine ⟨finitary_mono f, fun X => Set.Subset.antisymm ?_ (finitary_mono f Set.subset_union_left)⟩
  rintro r ⟨L, hL, hLX, hr⟩
  have hw : ∀ y ∈ L \ X, ∃ M : Set R, M.Finite ∧ M ⊆ X ∧ y ∈ f M := by
    intro y ⟨hyL, hyX⟩
    rcases hLX hyL with h | h
    · exact absurd h hyX
    · exact h
  choose! M hM using hw
  let L' : Set R := (L ∩ X) ∪ ⋃ y ∈ L \ X, M y
  have hL'fin : L'.Finite :=
    (hL.subset Set.inter_subset_left).union
      ((hL.subset Set.sdiff_subset).biUnion fun y hy => (hM y hy).1)
  have hL'X : L' ⊆ X := by
    rintro y (h | h)
    · exact h.2
    · obtain ⟨z, hz, hy⟩ := Set.mem_iUnion₂.mp h
      exact (hM z hz).2.1 hy
  have hLL' : L ⊆ L' ∪ f L' := by
    intro y hy
    by_cases hyX : y ∈ X
    · exact Or.inl (Or.inl ⟨hy, hyX⟩)
    · refine Or.inr (hb.1 ?_ (hM y ⟨hy, hyX⟩).2.2)
      exact fun z hz => Or.inr (Set.mem_iUnion₂.mpr ⟨y, ⟨hy, hyX⟩, hz⟩)
  refine ⟨L', hL'fin, hL'X, ?_⟩
  have := hb.1 hLL' hr
  rwa [hb.2] at this

namespace LogNet

variable (N : LogNet ι R)

/-! ## The receive rule -/

/-- Each unit has emitted exactly `Out` of its log, and its log holds what it emitted. -/
def Inv (x : St ι R) : Prop := ∀ u, (x u).2 = N.Out u (x u).1 ∧ N.Out u (x u).1 ⊆ (x u).1

theorem inv_recv' {u : ι} (hb : MonotoneBox (N.Out u)) {p : Set R × Set R}
    (hp : p.2 = N.Out u p.1) (X : Set R) :
    (N.recvSet u p X).2 = N.Out u (N.recvSet u p X).1 ∧
      N.Out u (N.recvSet u p X).1 ⊆ (N.recvSet u p X).1 := by
  have h := hb.2 (p.1 ∪ X)
  have hm : N.Out u p.1 ⊆ N.Out u (p.1 ∪ X) := hb.1 Set.subset_union_left
  simp only [recvSet]
  rw [h, hp, Set.union_eq_right.mpr hm]
  exact ⟨rfl, Set.subset_union_right⟩

/-- **A monotone box reads a set in any order to the same state.** Reading the records of a list
one after another gives the state that reading their set gives. -/
theorem recv_fold {u : ι} (hb : MonotoneBox (N.Out u)) (l : List R) {p : Set R × Set R}
    (hp : p.2 = N.Out u p.1 ∧ N.Out u p.1 ⊆ p.1) :
    l.foldl (N.recv u) p = N.recvSet u p {r | r ∈ l} := by
  induction l generalizing p with
  | nil =>
    have h1 : p.1 ∪ {r | r ∈ ([] : List R)} = p.1 := by
      ext r
      simp
    simp only [List.foldl_nil, recvSet, h1, Set.union_eq_left.mpr hp.2]
    rw [← hp.1, Set.union_self]
  | cons r l ih =>
    rw [List.foldl_cons, ih (p := N.recv u p r) (N.inv_recv' hb hp.1 {r})]
    have hs : {x | x ∈ r :: l} = {r} ∪ {x | x ∈ l} := by
      ext x
      simp
    obtain ⟨h1, h2⟩ := closure_step hb p.1 {r} {x | x ∈ l}
    simp only [recvSet, recv, hs]
    refine Prod.ext ?_ ?_
    · show p.1 ∪ {r} ∪ N.Out u (p.1 ∪ {r}) ∪ {x | x ∈ l} ∪
          N.Out u (p.1 ∪ {r} ∪ N.Out u (p.1 ∪ {r}) ∪ {x | x ∈ l}) =
        p.1 ∪ ({r} ∪ {x | x ∈ l}) ∪ N.Out u (p.1 ∪ ({r} ∪ {x | x ∈ l}))
      rw [h1]
      exact h2
    · show p.2 ∪ N.Out u (p.1 ∪ {r}) ∪ N.Out u (p.1 ∪ {r} ∪ N.Out u (p.1 ∪ {r}) ∪ {x | x ∈ l}) =
        p.2 ∪ N.Out u (p.1 ∪ ({r} ∪ {x | x ∈ l}))
      rw [h1, Set.union_assoc,
        Set.union_eq_right.mpr (hb.1 (Set.union_subset_union_right p.1 Set.subset_union_left))]

/-- Two lists with the same records are read to the same state. -/
theorem fold_order {u : ι} (hb : MonotoneBox (N.Out u)) {l l' : List R}
    (h : ∀ r, r ∈ l ↔ r ∈ l') {p : Set R × Set R} (hp : p.2 = N.Out u p.1 ∧ N.Out u p.1 ⊆ p.1) :
    l.foldl (N.recv u) p = l'.foldl (N.recv u) p := by
  rw [N.recv_fold hb l hp, N.recv_fold hb l' hp]
  congr 2
  ext r
  exact h r

/-- Reading a record already in the log changes nothing. -/
theorem recv_dup {u : ι} {p : Set R × Set R} (hp : p.2 = N.Out u p.1 ∧ N.Out u p.1 ⊆ p.1)
    {r : R} (hr : r ∈ p.1) : N.recv u p r = p := by
  have h : p.1 ∪ {r} = p.1 := Set.union_eq_left.mpr (Set.singleton_subset_iff.mpr hr)
  simp only [recv, h, Set.union_eq_left.mpr hp.2]
  rw [← hp.1, Set.union_self]

/-! ## Runs -/

theorem deliver_apply (x : St ι R) (w : Option ι) (u' : ι) (r : R) (u : ι) :
    N.deliver x (w, u', r) u =
      if r ∈ N.mailbox x w u' ∧ u = u' then N.recv u (x u) r else x u := by
  unfold deliver
  by_cases hr : r ∈ N.mailbox x w u'
  · rw [ite_eq_left hr]
    by_cases hu : u = u'
    · subst hu
      simp [hr]
    · simp [hu]
  · simp [hr]

theorem inv_init (h0 : ∀ u, N.Out u (N.L0 u) = ∅) : N.Inv N.init := by
  intro u
  refine ⟨(h0 u).symm, ?_⟩
  show N.Out u (N.L0 u) ⊆ N.L0 u
  rw [h0 u]
  exact Set.empty_subset _

theorem inv_recv (hbox : ∀ u, MonotoneBox (N.Out u)) {u : ι} {p : Set R × Set R}
    (hp : p.2 = N.Out u p.1) (r : R) :
    (N.recv u p r).2 = N.Out u (N.recv u p r).1 ∧ N.Out u (N.recv u p r).1 ⊆ (N.recv u p r).1 :=
  N.inv_recv' (hbox u) hp {r}

theorem inv_deliver (hbox : ∀ u, MonotoneBox (N.Out u)) {x : St ι R} (hx : N.Inv x)
    (d : Ev ι R) : N.Inv (N.deliver x d) := by
  obtain ⟨w, u', r⟩ := d
  intro u
  rw [deliver_apply]
  split_ifs
  · exact N.inv_recv hbox (hx u).1 r
  · exact hx u

theorem inv_run (hbox : ∀ u, MonotoneBox (N.Out u)) (h0 : ∀ u, N.Out u (N.L0 u) = ∅)
    (σ : ℕ → Ev ι R) (n : ℕ) : N.Inv (N.run σ n) := by
  induction n with
  | zero => exact N.inv_init h0
  | succ n ih => exact N.inv_deliver hbox ih (σ n)

theorem log_le_deliver (x : St ι R) (d : Ev ι R) (u : ι) :
    (x u).1 ⊆ (N.deliver x d u).1 := by
  obtain ⟨w, u', r⟩ := d
  rw [deliver_apply]
  split_ifs
  · intro s hs
    exact Or.inl (Or.inl hs)
  · exact subset_rfl

theorem emitted_le_deliver (x : St ι R) (d : Ev ι R) (u : ι) :
    (x u).2 ⊆ (N.deliver x d u).2 := by
  obtain ⟨w, u', r⟩ := d
  rw [deliver_apply]
  split_ifs
  · intro s hs
    exact Or.inl hs
  · exact subset_rfl

theorem logs_mono (σ : ℕ → Ev ι R) (u : ι) : Monotone fun n => N.logs σ n u :=
  monotone_nat_of_le_succ fun n => N.log_le_deliver (N.run σ n) (σ n) u

theorem emitted_mono (σ : ℕ → Ev ι R) (u : ι) : Monotone fun n => (N.run σ n u).2 :=
  monotone_nat_of_le_succ fun n => N.emitted_le_deliver (N.run σ n) (σ n) u

/-- With pairings that only grow, a record waiting in a mailbox keeps waiting. -/
theorem mailbox_mono (hP : ∀ w u, Monotone (N.pairs w u)) (σ : ℕ → Ev ι R) {n m : ℕ}
    (h : n ≤ m) {w : Option ι} {u : ι} {r : R} (hr : r ∈ N.mailbox (N.run σ n) w u) :
    r ∈ N.mailbox (N.run σ m) w u := by
  cases w with
  | none => exact hr
  | some w =>
    obtain ⟨hp, ha, hs⟩ := hr
    exact ⟨hP w u (N.logs_mono σ w h) hp, ha, N.emitted_mono σ w h hs⟩

theorem deliverable_mono {L L' : ι → Set R} (hOut : ∀ u, Monotone (N.Out u))
    (hP : ∀ w u, Monotone (N.pairs w u)) (h : L ≤ L') (u : ι) :
    N.deliverable L u ⊆ N.deliverable L' u :=
  fun _ ⟨w, hw, ha, ho⟩ => ⟨w, hP w u (h w) hw, ha, hOut w (h w) ho⟩

theorem lfp_closed (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u)) (u : ι) :
    N.base u ∪ N.deliverable (lfp (N.F hOut hP)) u ∪ N.Out u (lfp (N.F hOut hP) u) ⊆
      lfp (N.F hOut hP) u :=
  (congrFun (OrderHom.map_lfp (N.F hOut hP)) u).le

/-- The least fixed point adds to each initial log only outside inputs and emissions. -/
theorem lfp_bound (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    {E : Set R} (hE : ∀ u, N.In u ⊆ E ∧ N.Out u (lfp (N.F hOut hP) u) ⊆ E) (u : ι) :
    lfp (N.F hOut hP) u ⊆ N.L0 u ∪ E := by
  let G : ι → Set R := fun v => lfp (N.F hOut hP) v ∩ (N.L0 v ∪ E)
  have hGM : G ≤ lfp (N.F hOut hP) := fun v => Set.inter_subset_left
  have key : lfp (N.F hOut hP) ≤ G := by
    apply OrderHom.lfp_le
    intro v r hr
    refine ⟨(congrFun (OrderHom.map_lfp (N.F hOut hP)) v).le ((N.F hOut hP).monotone hGM v hr), ?_⟩
    rcases hr with ((h | h) | ⟨w, -, -, ho⟩) | h
    · exact Or.inl h
    · exact Or.inr ((hE v).1 h)
    · exact Or.inr ((hE w).2 (hOut w (hGM w) ho))
    · exact Or.inr ((hE v).2 (hOut v (hGM v) h))
  exact fun r hr => (key u hr).2

theorem init_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (u : ι) : (N.init u).1 ⊆ N.least hbox hP u :=
  fun _ hr => N.lfp_closed (fun u => (hbox u).1) hP u (Or.inl (Or.inl (Or.inl hr)))

theorem deliver_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    {x : St ι R} (hx : ∀ u, (x u).1 ⊆ N.least hbox hP u) (hinv : N.Inv x)
    (d : Ev ι R) (u : ι) : (N.deliver x d u).1 ⊆ N.least hbox hP u := by
  obtain ⟨w, u', r⟩ := d
  rw [deliver_apply]
  split_ifs with h
  · obtain ⟨hmb, rfl⟩ := h
    have hc := N.lfp_closed (fun u => (hbox u).1) hP u
    have hrM : r ∈ N.least hbox hP u := by
      cases w with
      | none => exact hc (Or.inl (Or.inl (Or.inr hmb)))
      | some w =>
        obtain ⟨hpw, ha, hs⟩ := hmb
        have hs' : r ∈ N.Out w (x w).1 := (hinv w).1 ▸ hs
        exact hc (Or.inl (Or.inr ⟨w, hP w u (hx w) hpw, ha, (hbox w).1 (hx w) hs'⟩))
    have hX : (x u).1 ∪ {r} ⊆ N.least hbox hP u :=
      Set.union_subset (hx u) (Set.singleton_subset_iff.mpr hrM)
    show (x u).1 ∪ {r} ∪ N.Out u ((x u).1 ∪ {r}) ⊆ _
    exact Set.union_subset hX fun s hs => hc (Or.inr ((hbox u).1 hX hs))
  · exact hx u

theorem run_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (h0 : ∀ u, N.Out u (N.L0 u) = ∅)
    (hP : ∀ w u, Monotone (N.pairs w u)) (σ : ℕ → Ev ι R) (n : ℕ) (u : ι) :
    N.logs σ n u ⊆ N.least hbox hP u := by
  induction n generalizing u with
  | zero => exact N.init_le_lfp hbox hP u
  | succ n ih => exact N.deliver_le_lfp hbox hP ih (N.inv_run hbox h0 σ n) (σ n) u

/-- Under a fair schedule, whatever is ever waiting for `u` reaches its log. -/
theorem run_delivers (σ : ℕ → Ev ι R) (hσ : N.Fair σ) {n : ℕ} {w : Option ι} {u : ι} {r : R}
    (hmb : r ∈ N.mailbox (N.run σ n) w u) : ∃ m, r ∈ N.logs σ m u := by
  obtain ⟨m, hσm, hmb'⟩ := hσ n w u r hmb
  refine ⟨m + 1, ?_⟩
  show r ∈ (N.deliver (N.run σ m) (σ m) u).1
  rw [hσm, deliver_apply, ite_eq_left ⟨hmb', rfl⟩]
  exact Or.inl (Or.inr rfl)

/-- The union of an increasing sequence of logs is the least fixed point, when it stays below the
fixed point, reaches every initial record and outside input, keeps every log closed under its box,
delivers whatever can be delivered, and reaches every pairing and emission of the union at a finite
stage. -/
theorem union_eq_lfp (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (f : ℕ → ι → Set R) (hle : ∀ n u, f n u ⊆ lfp (N.F hOut hP) u)
    (hbase : ∀ u r, r ∈ N.base u → ∃ m, r ∈ f m u)
    (hclosed : ∀ n u, N.Out u (f n u) ⊆ f n u)
    (hdel : ∀ n w u r, N.pairs w u (f n w) → N.aud r u → r ∈ N.Out w (f n w) → ∃ m, r ∈ f m u)
    (hcP : ∀ w u r, N.pairs w u (⋃ n, f n w) → r ∈ N.Out w (⋃ n, f n w) →
      ∃ n, N.pairs w u (f n w) ∧ r ∈ N.Out w (f n w))
    (hcO : ∀ u r, r ∈ N.Out u (⋃ n, f n u) → ∃ n, r ∈ N.Out u (f n u)) :
    (fun u => ⋃ n, f n u) = lfp (N.F hOut hP) := by
  apply le_antisymm
  · intro u
    exact Set.iUnion_subset fun n => hle n u
  · apply OrderHom.lfp_le
    intro u r hr
    rcases hr with (hr | ⟨w, hp, ha, ho⟩) | hr
    · obtain ⟨m, hm⟩ := hbase u r hr
      exact Set.mem_iUnion.mpr ⟨m, hm⟩
    · obtain ⟨n, hpn, hon⟩ := hcP w u r hp ho
      obtain ⟨m, hm⟩ := hdel n w u r hpn ha hon
      exact Set.mem_iUnion.mpr ⟨m, hm⟩
    · obtain ⟨n, hn⟩ := hcO u r hr
      exact Set.mem_iUnion.mpr ⟨n, hclosed n u hn⟩

/-- `union_eq_lfp` when every unit's log settles. -/
theorem union_eq_lfp_settled (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (f : ℕ → ι → Set R) (hmono : ∀ u, Monotone fun n => f n u)
    (hle : ∀ n u, f n u ⊆ lfp (N.F hOut hP) u) (hbase : ∀ u r, r ∈ N.base u → ∃ m, r ∈ f m u)
    (hclosed : ∀ n u, N.Out u (f n u) ⊆ f n u)
    (hdel : ∀ n w u r, N.pairs w u (f n w) → N.aud r u → r ∈ N.Out w (f n w) → ∃ m, r ∈ f m u)
    (hset : ∀ u, ∃ n, ∀ m, n ≤ m → f m u = f n u) :
    (fun u => ⋃ n, f n u) = lfp (N.F hOut hP) := by
  have hU : ∀ u, ∃ n, (⋃ m, f m u) = f n u := fun u =>
    let ⟨n, hn⟩ := hset u
    ⟨n, union_of_settled (hmono u) hn⟩
  refine N.union_eq_lfp hOut hP f hle hbase hclosed hdel ?_ ?_
  · intro w u r hp ho
    obtain ⟨n, hn⟩ := hU w
    rw [hn] at hp ho
    exact ⟨n, hp, ho⟩
  · intro u r hr
    obtain ⟨n, hn⟩ := hU u
    rw [hn] at hr
    exact ⟨n, hr⟩

/-- `union_eq_lfp` when the boxes and the pairings preserve unions of increasing chains. -/
theorem union_eq_lfp_chain (hP : ∀ w u, Monotone (N.pairs w u))
    (hOc : ∀ u, ωScottContinuous (N.Out u)) (hPc : ∀ w u, ωScottContinuous (N.pairs w u))
    (f : ℕ → ι → Set R) (hmono : ∀ u, Monotone fun n => f n u)
    (hle : ∀ n u, f n u ⊆ lfp (N.F (fun u => (hOc u).monotone) hP) u)
    (hbase : ∀ u r, r ∈ N.base u → ∃ m, r ∈ f m u)
    (hclosed : ∀ n u, N.Out u (f n u) ⊆ f n u)
    (hdel : ∀ n w u r, N.pairs w u (f n w) → N.aud r u → r ∈ N.Out w (f n w) → ∃ m, r ∈ f m u) :
    (fun u => ⋃ n, f n u) = lfp (N.F (fun u => (hOc u).monotone) hP) := by
  refine N.union_eq_lfp _ hP f hle hbase hclosed hdel ?_ ?_
  · intro w u r hp ho
    obtain ⟨n₁, hn₁⟩ := cont_prop (hPc w u) _ (hmono w) hp
    rw [cont_iUnion (hOc w) _ (hmono w)] at ho
    obtain ⟨n₂, hn₂⟩ := Set.mem_iUnion.mp ho
    refine ⟨max n₁ n₂, hP w u (hmono w (le_max_left _ _)) hn₁, ?_⟩
    exact (hOc w).monotone (hmono w (le_max_right _ _)) hn₂
  · intro u r hr
    rw [cont_iUnion (hOc u) _ (hmono u)] at hr
    exact Set.mem_iUnion.mp hr

/-! ### Rounds -/

theorem rounds_mono (u : ι) : Monotone fun n => N.rounds n u :=
  monotone_nat_of_le_succ fun _ _ hr => Or.inl (Or.inl hr)

/-- A round is the unit reading, one after another, everything that reaches it (`recv_fold`). -/
theorem roundStep_eq (L : ι → Set R) (u : ι) :
    N.roundStep L u = (N.recvSet u (L u, N.Out u (L u)) (N.incoming L u)).1 := rfl

theorem rounds_closed (hbox : ∀ u, MonotoneBox (N.Out u)) (h0 : ∀ u, N.Out u (N.L0 u) = ∅)
    (n : ℕ) (u : ι) : N.Out u (N.rounds n u) ⊆ N.rounds n u := by
  cases n with
  | zero => exact (N.inv_init h0 u).2
  | succ n =>
    show N.Out u (N.roundStep (N.rounds n) u) ⊆ N.roundStep (N.rounds n) u
    unfold roundStep
    rw [(hbox u).2]
    exact Set.subset_union_right

theorem rounds_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (n : ℕ) (u : ι) : N.rounds n u ⊆ N.least hbox hP u := by
  induction n generalizing u with
  | zero => exact N.init_le_lfp hbox hP u
  | succ n ih =>
    have hc := N.lfp_closed (fun u => (hbox u).1) hP u
    have hX : N.rounds n u ∪ N.incoming (N.rounds n) u ⊆ N.least hbox hP u := by
      refine Set.union_subset (ih u) ?_
      rintro r (hr | hr)
      · exact hc (Or.inl (Or.inl (Or.inr hr)))
      · exact hc (Or.inl (Or.inr (N.deliverable_mono (fun u => (hbox u).1) hP ih u hr)))
    exact Set.union_subset hX fun r hr => hc (Or.inr ((hbox u).1 hX hr))

theorem rounds_base (u : ι) (r : R) (hr : r ∈ N.base u) : ∃ m, r ∈ N.rounds m u := by
  rcases hr with hr | hr
  · exact ⟨0, hr⟩
  · exact ⟨1, Or.inl (Or.inr (Or.inl hr))⟩

theorem rounds_delivers {n : ℕ} {w u : ι} {r : R} (hp : N.pairs w u (N.rounds n w))
    (ha : N.aud r u) (ho : r ∈ N.Out w (N.rounds n w)) : ∃ m, r ∈ N.rounds m u :=
  ⟨n + 1, Or.inl (Or.inr (Or.inr ⟨w, hp, ha, ho⟩))⟩

/-! ### Runs reach the least fixed point -/

theorem run_base (σ : ℕ → Ev ι R) (hσ : N.Fair σ) (u : ι) (r : R) (hr : r ∈ N.base u) :
    ∃ m, r ∈ N.logs σ m u := by
  rcases hr with hr | hr
  · exact ⟨0, hr⟩
  · exact N.run_delivers σ hσ (n := 0) (w := none) hr

theorem run_deliverable (hbox : ∀ u, MonotoneBox (N.Out u)) (h0 : ∀ u, N.Out u (N.L0 u) = ∅)
    (σ : ℕ → Ev ι R) (hσ : N.Fair σ) (n : ℕ) (w u : ι) (r : R)
    (hp : N.pairs w u (N.logs σ n w)) (ha : N.aud r u) (ho : r ∈ N.Out w (N.logs σ n w)) :
    ∃ m, r ∈ N.logs σ m u := by
  refine N.run_delivers σ hσ (n := n) (w := some w) ⟨hp, ha, ?_⟩
  rw [(N.inv_run hbox h0 σ n w).1]
  exact ho

/-! ### Pairings read on the logs that can arise -/

theorem mailbox_within {Z : Set R} {x : St ι R} (hx : ∀ u, (x u).1 ⊆ Z) (w : Option ι) (u : ι) :
    (N.within Z).mailbox x w u = N.mailbox x w u := by
  cases w with
  | none => rfl
  | some w =>
    show {r | N.pairs w u ((x w).1 ∩ Z) ∧ _} = {r | N.pairs w u (x w).1 ∧ _}
    rw [Set.inter_eq_left.mpr (hx w)]
    rfl

/-- When every initial log, outside input and emission lies in `Z`, the runs of `N` are those of
`N.within Z`, and every log and emission along them lies in `Z`. -/
theorem run_within {Z : Set R} (hZ0 : ∀ u, N.L0 u ⊆ Z) (hZi : ∀ u, N.In u ⊆ Z)
    (hZo : ∀ u X, X ⊆ Z → N.Out u X ⊆ Z) (σ : ℕ → Ev ι R) (n : ℕ) :
    (N.within Z).run σ n = N.run σ n ∧ ∀ u, (N.run σ n u).1 ⊆ Z ∧ (N.run σ n u).2 ⊆ Z := by
  induction n with
  | zero => exact ⟨rfl, fun u => ⟨hZ0 u, Set.empty_subset _⟩⟩
  | succ n ih =>
    obtain ⟨heq, hZ⟩ := ih
    have hstep : (N.within Z).run σ (n + 1) = N.run σ (n + 1) := by
      show (N.within Z).deliver ((N.within Z).run σ n) (σ n) = N.deliver (N.run σ n) (σ n)
      rw [heq]
      obtain ⟨w, u', r⟩ := σ n
      funext u
      rw [deliver_apply, deliver_apply, N.mailbox_within (fun v => (hZ v).1)]
      rfl
    refine ⟨hstep, fun u => ?_⟩
    show (N.deliver (N.run σ n) (σ n) u).1 ⊆ Z ∧ (N.deliver (N.run σ n) (σ n) u).2 ⊆ Z
    obtain ⟨w, u', r⟩ := σ n
    rw [deliver_apply]
    split_ifs with h
    · obtain ⟨hmb, rfl⟩ := h
      have hr : r ∈ Z := by
        cases w with
        | none => exact hZi u hmb
        | some w => exact (hZ w).2 hmb.2.2
      have hX : (N.run σ n u).1 ∪ {r} ⊆ Z :=
        Set.union_subset (hZ u).1 (Set.singleton_subset_iff.mpr hr)
      exact ⟨Set.union_subset hX (hZo u _ hX), Set.union_subset (hZ u).2 (hZo u _ hX)⟩
    · exact hZ u

theorem fair_within {Z : Set R} (hZ0 : ∀ u, N.L0 u ⊆ Z) (hZi : ∀ u, N.In u ⊆ Z)
    (hZo : ∀ u X, X ⊆ Z → N.Out u X ⊆ Z) {σ : ℕ → Ev ι R} (hσ : N.Fair σ) :
    (N.within Z).Fair σ := by
  intro n w u r hr
  have hrun := fun n => N.run_within hZ0 hZi hZo σ n
  rw [(hrun n).1, N.mailbox_within (fun v => ((hrun n).2 v).1)] at hr
  obtain ⟨m, hσm, hm⟩ := hσ n w u r hr
  refine ⟨m, hσm, ?_⟩
  rw [(hrun m).1, N.mailbox_within (fun v => ((hrun m).2 v).1)]
  exact hm

theorem within_mono {Z : Set R}
    (hPZ : ∀ w u X Y, X ⊆ Y → Y ⊆ Z → N.pairs w u X → N.pairs w u Y) :
    ∀ w u, Monotone ((N.within Z).pairs w u) :=
  fun w u _ _ h hp => hPZ w u _ _ (Set.inter_subset_inter_left Z h) Set.inter_subset_right hp

end LogNet

section theorems

variable (N : LogNet ι R) (hbox : ∀ u, MonotoneBox (N.Out u)) (h0 : ∀ u, N.Out u (N.L0 u) = ∅)
  (hP : ∀ w u, Monotone (N.pairs w u))

include h0

/-- **Order independence (ii), unboundedly many units.** If only finitely many records can be input
or emitted, then whatever the number of units, every unit's log settles, along every fair schedule,
on its component of the least fixed point above the initial logs and the outside inputs. -/
theorem order_unbounded
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E)
    (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = N.least hbox hP u := by
  obtain ⟨E, hE, hOE⟩ := hfin
  have hset : ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = N.logs σ n u := fun u =>
    sets_settle (N.logs_mono σ u) hE fun n =>
      (N.run_le_lfp hbox h0 hP σ n u).trans (N.lfp_bound (fun u => (hbox u).1) hP hOE u)
  have hlim := N.union_eq_lfp_settled (fun u => (hbox u).1) hP (N.logs σ) (N.logs_mono σ)
    (N.run_le_lfp hbox h0 hP σ) (N.run_base σ hσ) (fun n u => (N.inv_run hbox h0 σ n u).2)
    (N.run_deliverable hbox h0 σ hσ) hset
  intro u
  obtain ⟨n, hn⟩ := hset u
  refine ⟨n, fun m hm => ?_⟩
  rw [hn m hm, ← union_of_settled (N.logs_mono σ u) hn]
  exact congrFun hlim u

/-- **Order independence (ii), unboundedly many units**, for two schedules: unit by unit, any two
fair schedules settle on the same log. -/
theorem order_unbounded_agree
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E)
    (σ τ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) (hτ : N.Fair τ) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = N.logs τ m u := by
  intro u
  obtain ⟨n₁, h₁⟩ := order_unbounded N hbox h0 hP hfin σ hσ u
  obtain ⟨n₂, h₂⟩ := order_unbounded N hbox h0 hP hfin τ hτ u
  exact ⟨max n₁ n₂, fun m hm =>
    (h₁ m (le_trans (le_max_left _ _) hm)).trans (h₂ m (le_trans (le_max_right _ _) hm)).symm⟩

/-- **Order independence (i).** With finitely many units, and finitely many records that can be
input or emitted, every fair schedule reaches the least fixed point above the initial logs and the
outside inputs, and stays there. -/
theorem order_finite [Finite ι]
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E)
    (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    ∃ n, ∀ m, n ≤ m → N.logs σ m = N.least hbox hP := by
  choose k hk using order_unbounded N hbox h0 hP hfin σ hσ
  obtain ⟨K, hK⟩ := (Set.finite_range k).bddAbove
  refine ⟨K, fun m hm => funext fun u => hk u m ?_⟩
  exact le_trans (hK ⟨u, rfl⟩) hm

/-- **Order independence (i)**, for two schedules: any two fair schedules reach the same logs and
stay there, and so agree on any view that is a function of the logs. -/
theorem order_finite_agree [Finite ι]
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E)
    (σ τ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) (hτ : N.Fair τ) :
    ∃ n, ∀ m, n ≤ m → N.logs σ m = N.logs τ m := by
  obtain ⟨n₁, h₁⟩ := order_finite N hbox h0 hP hfin σ hσ
  obtain ⟨n₂, h₂⟩ := order_finite N hbox h0 hP hfin τ hτ
  exact ⟨max n₁ n₂, fun m hm =>
    (h₁ m (le_trans (le_max_left _ _) hm)).trans (h₂ m (le_trans (le_max_right _ _) hm)).symm⟩

/-- **Order independence (iii).** When each box's `Out`, and each pairing as a function of the
sender's log, preserve unions of increasing chains, the union of the logs along every fair schedule
is the least fixed point above the initial logs and the outside inputs. -/
theorem order_chain (hOut : ∀ u, ωScottContinuous (N.Out u))
    (hPc : ∀ w u, ωScottContinuous (N.pairs w u)) (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    (fun u => ⋃ n, N.logs σ n u) = N.least hbox hP :=
  N.union_eq_lfp_chain hP hOut hPc (N.logs σ) (N.logs_mono σ)
    (N.run_le_lfp hbox h0 hP σ) (N.run_base σ hσ) (fun n u => (N.inv_run hbox h0 σ n u).2)
    (N.run_deliverable hbox h0 σ hσ)

/-- **Order independence (iii)** for boxes given on finite logs: when each `Out` is read on
infinite sets through its finite subsets, it preserves unions of increasing chains, so only the
pairings need to. -/
theorem order_chain_finitary (hfinitary : ∀ u, finitary (N.Out u) = N.Out u)
    (hPc : ∀ w u, ωScottContinuous (N.pairs w u)) (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    (fun u => ⋃ n, N.logs σ n u) = N.least hbox hP :=
  order_chain N hbox h0 hP (fun u => by rw [← hfinitary u]; exact finitary_continuous _) hPc σ hσ

/-- **Rounds are a fair schedule**, unboundedly many units: every unit's log settles over the rounds
on its component of the same least fixed point. -/
theorem rounds_unbounded
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.rounds m u = N.least hbox hP u := by
  obtain ⟨E, hE, hOE⟩ := hfin
  have hset : ∀ u, ∃ n, ∀ m, n ≤ m → N.rounds m u = N.rounds n u := fun u =>
    sets_settle (N.rounds_mono u) hE fun n =>
      (N.rounds_le_lfp hbox hP n u).trans (N.lfp_bound (fun u => (hbox u).1) hP hOE u)
  have hlim := N.union_eq_lfp_settled (fun u => (hbox u).1) hP N.rounds N.rounds_mono
    (N.rounds_le_lfp hbox hP) N.rounds_base (N.rounds_closed hbox h0)
    (fun _ _ _ _ hp ha ho => N.rounds_delivers hp ha ho) hset
  intro u
  obtain ⟨n, hn⟩ := hset u
  refine ⟨n, fun m hm => ?_⟩
  rw [hn m hm, ← union_of_settled (N.rounds_mono u) hn]
  exact congrFun hlim u

/-- **Rounds are a fair schedule**, finite case: running in rounds reaches the same logs as every
fair schedule in `order_finite`. -/
theorem rounds_finite [Finite ι]
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E) :
    ∃ n, ∀ m, n ≤ m → N.rounds m = N.least hbox hP := by
  choose k hk using rounds_unbounded N hbox h0 hP hfin
  obtain ⟨K, hK⟩ := (Set.finite_range k).bddAbove
  refine ⟨K, fun m hm => funext fun u => hk u m ?_⟩
  exact le_trans (hK ⟨u, rfl⟩) hm

/-- **Rounds are a fair schedule**, chain case: the union of the logs over all rounds is the same
least fixed point as in `order_chain`. -/
theorem rounds_chain (hOut : ∀ u, ωScottContinuous (N.Out u))
    (hPc : ∀ w u, ωScottContinuous (N.pairs w u)) :
    (fun u => ⋃ n, N.rounds n u) = N.least hbox hP :=
  N.union_eq_lfp_chain hP hOut hPc N.rounds N.rounds_mono
    (N.rounds_le_lfp hbox hP) N.rounds_base (N.rounds_closed hbox h0)
    (fun _ _ _ _ hp ha ho => N.rounds_delivers hp ha ho)

end theorems

section growing

variable (N : LogNet ι R) (hbox : ∀ u, MonotoneBox (N.Out u)) (h0 : ∀ u, N.Out u (N.L0 u) = ∅)
  {Z : Set R} (hZ0 : ∀ u, N.L0 u ⊆ Z) (hZi : ∀ u, N.In u ⊆ Z)
  (hZo : ∀ u X, X ⊆ Z → N.Out u X ⊆ Z)
  (hPZ : ∀ w u X Y, X ⊆ Y → Y ⊆ Z → N.pairs w u X → N.pairs w u Y)

include h0 hZ0 hZi hZo

/-- **Order independence with growing wiring**, unboundedly many units. Let `Z` hold every initial
log, outside input and emission, such as the records that are not revocations, and let pairings
only grow on logs inside `Z`. Then part (ii) of the theorem holds, with pairings read inside `Z`. -/
theorem growing_unbounded
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧
      N.Out u ((N.within Z).least hbox (N.within_mono hPZ) u) ⊆ E)
    (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = (N.within Z).least hbox (N.within_mono hPZ) u := by
  intro u
  obtain ⟨n, hn⟩ := order_unbounded (N.within Z) hbox h0 (N.within_mono hPZ) hfin σ
    (N.fair_within hZ0 hZi hZo hσ) u
  refine ⟨n, fun m hm => ?_⟩
  rw [← hn m hm]
  show (N.run σ m u).1 = ((N.within Z).run σ m u).1
  rw [(N.run_within hZ0 hZi hZo σ m).1]

/-- **Order independence with growing wiring**, finitely many units: part (i) of the theorem. -/
theorem growing_finite [Finite ι]
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧
      N.Out u ((N.within Z).least hbox (N.within_mono hPZ) u) ⊆ E)
    (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    ∃ n, ∀ m, n ≤ m → N.logs σ m = (N.within Z).least hbox (N.within_mono hPZ) := by
  obtain ⟨n, hn⟩ := order_finite (N.within Z) hbox h0 (N.within_mono hPZ) hfin σ
    (N.fair_within hZ0 hZi hZo hσ)
  refine ⟨n, fun m hm => ?_⟩
  rw [← hn m hm]
  funext u
  show (N.run σ m u).1 = ((N.within Z).run σ m u).1
  rw [(N.run_within hZ0 hZi hZo σ m).1]

/-- **Order independence with growing wiring**, unboundedly many records: part (iii) of the
theorem, when each pairing read inside `Z` is decided at a finite stage of an increasing chain. -/
theorem growing_chain (hOut : ∀ u, ωScottContinuous (N.Out u))
    (hPc : ∀ w u, ωScottContinuous ((N.within Z).pairs w u)) (σ : ℕ → LogNet.Ev ι R)
    (hσ : N.Fair σ) :
    (fun u => ⋃ n, N.logs σ n u) = (N.within Z).least hbox (N.within_mono hPZ) := by
  rw [← order_chain (N.within Z) hbox h0 (N.within_mono hPZ) hOut hPc σ
    (N.fair_within hZ0 hZi hZo hσ)]
  funext u
  congr 1
  funext n
  show (N.run σ n u).1 = ((N.within Z).run σ n u).1
  rw [(N.run_within hZ0 hZi hZo σ n).1]

end growing

/-- **No global quiescence.** There is a network with infinitely many units, monotone boxes that
start having emitted nothing, pairings that never change and a single record, which a person in the
hub enters, and a fair schedule along which the logs are never the least fixed point: at every step
some unit has yet to receive the record. Each unit's log still settles, by `order_unbounded`. -/
theorem no_global_quiescence :
    ∃ (N : LogNet ℕ Unit) (hbox : ∀ u, MonotoneBox (N.Out u))
      (hP : ∀ w u, Monotone (N.pairs w u)) (σ : ℕ → LogNet.Ev ℕ Unit),
      (∀ u, N.Out u (N.L0 u) = ∅) ∧ N.Fair σ ∧ ∀ n, N.logs σ n ≠ N.least hbox hP := by
  let N : LogNet ℕ Unit :=
    { aud := fun _ _ => True
      pairs := fun w _ _ => w = 0
      Out := fun u X => if u = 0 then X else ∅
      L0 := fun _ => ∅
      In := fun u => if u = 0 then Set.univ else ∅ }
  have hbox : ∀ u, MonotoneBox (N.Out u) := by
    intro u
    by_cases hu : u = 0
    · subst hu
      exact ⟨fun _ _ h => h, fun X => Set.union_self X⟩
    · refine ⟨fun _ _ _ => ?_, fun _ => ?_⟩
      · show (if u = 0 then _ else ∅ : Set Unit) ⊆ (if u = 0 then _ else ∅ : Set Unit)
        rw [ite_eq_right hu, ite_eq_right hu]
      · show (if u = 0 then _ else ∅) = (if u = 0 then _ else ∅)
        rw [ite_eq_right hu, ite_eq_right hu]
  have hP : ∀ w u, Monotone (N.pairs w u) := fun _ _ => monotone_const
  let σ : ℕ → LogNet.Ev ℕ Unit := fun m =>
    Nat.casesOn m (none, 0, ()) fun j => (some 0, (Nat.unpair j).1, ())
  refine ⟨N, hbox, hP, σ, fun u => ?_, ?_, ?_⟩
  · show (if u = 0 then ∅ else ∅) = ∅
    split_ifs <;> rfl
  · intro n w u r hr
    cases w with
    | none =>
      have hu : u = 0 := by
        by_contra hu
        have h' : r ∈ (if u = 0 then Set.univ else ∅ : Set Unit) := hr
        rw [ite_eq_right hu] at h'
        exact h'
      subst hu
      exact ⟨0, rfl, Set.mem_univ _⟩
    | some w =>
      have hw : w = 0 := hr.1
      subst hw
      refine ⟨Nat.pair u n + 1, ?_, N.mailbox_mono hP σ ?_ hr⟩
      · show (some 0, (Nat.unpair (Nat.pair u n)).1, ()) = (some 0, u, r)
        rw [Nat.unpair_pair]
      · have := Nat.right_le_pair u n
        omega
  · have key : ∀ n u, u ≠ 0 → () ∈ N.logs σ n u → ∃ j, j < n ∧ (Nat.unpair j).1 = u := by
      intro n
      induction n with
      | zero =>
        intro u _ h
        exact False.elim h
      | succ n ih =>
        intro u hu h
        have h' : () ∈ (N.deliver (N.run σ n) (σ n) u).1 := h
        rcases n with _ | j
        · have hσ0 : σ 0 = (none, 0, ()) := rfl
          rw [hσ0, LogNet.deliver_apply] at h'
          split_ifs at h' with hc
          · exact absurd hc.2 hu
          · obtain ⟨m, hm, hmu⟩ := ih u hu h'
            exact ⟨m, Nat.lt_succ_of_lt hm, hmu⟩
        · have hσj : σ (j + 1) = (some 0, (Nat.unpair j).1, ()) := rfl
          rw [hσj, LogNet.deliver_apply] at h'
          split_ifs at h' with hc
          · exact ⟨j, by omega, hc.2.symm⟩
          · obtain ⟨m, hm, hmu⟩ := ih u hu h'
            exact ⟨m, Nat.lt_succ_of_lt hm, hmu⟩
    intro n heq
    have hc := fun u => N.lfp_closed (fun u => (hbox u).1) hP u
    have h0 : () ∈ N.least hbox hP 0 := hc 0 (Or.inl (Or.inl (Or.inr (by simp [N]))))
    have h0' : () ∈ N.Out 0 (N.least hbox hP 0) := by
      show () ∈ (if (0 : ℕ) = 0 then _ else ∅)
      rw [ite_eq_left rfl]
      exact h0
    have hM : () ∈ N.least hbox hP (n + 1) :=
      hc (n + 1) (Or.inl (Or.inr ⟨0, rfl, trivial, h0'⟩))
    rw [← heq] at hM
    obtain ⟨m, hm, hmu⟩ := key n (n + 1) (Nat.succ_ne_zero n) hM
    have := Nat.unpair_left_le m
    omega

/-- **Pairings form through outside inputs.** A wire need not exist at the start. Here both units
receive the pairing record `false` from outside, as in a pairing ceremony, and unit `false` sends
its record `true` to unit `true` once the pairing stands in its log. Every fair schedule delivers
it. -/
theorem pairing_forms :
    ∃ (N : LogNet Bool Bool) (_ : ∀ u, MonotoneBox (N.Out u))
      (_ : ∀ w u, Monotone (N.pairs w u)),
      (∀ u, N.Out u (N.L0 u) = ∅) ∧ ¬ N.pairs false true (N.L0 false) ∧
      ∀ σ, N.Fair σ → ∃ n, true ∈ N.logs σ n true := by
  let N : LogNet Bool Bool :=
    { aud := fun r u => r = true ∧ u = true
      pairs := fun w u X => w = false ∧ u = true ∧ false ∈ X
      Out := fun w X => {r | r = true ∧ w = false ∧ false ∈ X}
      L0 := fun _ => ∅
      In := fun _ => {false} }
  have hbox : ∀ u, MonotoneBox (N.Out u) := by
    intro u
    refine ⟨fun X Y h r ⟨h1, h2, h3⟩ => ⟨h1, h2, h h3⟩, fun X => ?_⟩
    ext r
    constructor
    · rintro ⟨h1, h2, h3 | ⟨h3, -⟩⟩
      · exact ⟨h1, h2, h3⟩
      · exact absurd h3 Bool.false_ne_true
    · rintro ⟨h1, h2, h3⟩
      exact ⟨h1, h2, Or.inl h3⟩
  have hP : ∀ w u, Monotone (N.pairs w u) := fun _ _ _ _ h ⟨h1, h2, h3⟩ => ⟨h1, h2, h h3⟩
  refine ⟨N, hbox, hP, fun u => ?_, fun h => h.2.2, fun σ hσ => ?_⟩
  · ext r
    exact ⟨fun h => h.2.2, fun h => h.elim⟩
  have hc := fun u => N.lfp_closed (fun u => (hbox u).1) hP u
  have hp0 : false ∈ N.least hbox hP false := hc false (Or.inl (Or.inl (Or.inr rfl)))
  have hm : true ∈ N.least hbox hP true :=
    hc true (Or.inl (Or.inr ⟨false, ⟨rfl, rfl, hp0⟩, ⟨rfl, rfl⟩, ⟨rfl, rfl, hp0⟩⟩))
  have hfin : ∃ E : Set Bool, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E :=
    ⟨Set.univ, Set.finite_univ, fun _ => ⟨Set.subset_univ _, Set.subset_univ _⟩⟩
  obtain ⟨n, hn⟩ := order_unbounded N hbox (fun u => by ext r; exact ⟨fun h => h.2.2, fun h => h.elim⟩)
    hP hfin σ hσ true
  exact ⟨n, by rw [hn n le_rfl]; exact hm⟩

/-- **A non-monotone condition depends on the order.** Suppose unit `u` emits `o` once it holds the
trigger `t` without the objection `x`, and never emits `o` while it holds `x`, as with "no objection
by the deadline" or "not revoked". Let pairings only grow. If, at some point of a run, `t` and `x`
are both waiting in `u`'s mailboxes, `x` is not in `u`'s log and `u` has not emitted `o`, then the
run can be continued by two fair schedules: under one `u` emits `o`, and under the other it never
does. -/
theorem nonmono [Countable ι] [Countable R] (N : LogNet ι R) (hP : ∀ w u, Monotone (N.pairs w u))
    (π : ℕ → LogNet.Ev ι R) (k : ℕ) {u : ι} {a b : Option ι} {t x o : R}
    (ht : t ∈ N.mailbox (N.run π k) a u) (hx : x ∈ N.mailbox (N.run π k) b u) (hxt : x ≠ t)
    (hxL : x ∉ (N.run π k u).1) (ho : o ∉ (N.run π k u).2)
    (hfire : ∀ X, t ∈ X → x ∉ X → o ∈ N.Out u X) (hblock : ∀ X, x ∈ X → o ∉ N.Out u X) :
    ∃ σ τ, N.Fair σ ∧ N.Fair τ ∧ (∀ n, n < k → σ n = π n ∧ τ n = π n) ∧
      (∃ n, o ∈ (N.run σ n u).2) ∧ ∀ n, o ∉ (N.run τ n u).2 := by
  have : Nonempty (LogNet.Ev ι R) := ⟨(a, u, t)⟩
  obtain ⟨e, he⟩ := exists_surjective_nat (LogNet.Ev ι R)
  let sched : LogNet.Ev ι R → ℕ → LogNet.Ev ι R := fun d n =>
    if n < k then π n else if n = k then d else e (Nat.unpair (n - (k + 1))).1
  have hlt : ∀ d n, n < k → sched d n = π n := fun d n h => by
    simp only [sched]
    rw [ite_eq_left h]
  have hk : ∀ d, sched d k = d := fun d => by
    simp [sched]
  have hgt : ∀ d j, sched d (k + 1 + j) = e (Nat.unpair j).1 := fun d j => by
    simp only [sched]
    rw [ite_eq_right (by omega), ite_eq_right (by omega)]
    congr 3
    omega
  have hpre : ∀ d n, n ≤ k → N.run (sched d) n = N.run π n := by
    intro d n hn
    induction n with
    | zero => rfl
    | succ n ih =>
      show N.deliver (N.run (sched d) n) (sched d n) = N.deliver (N.run π n) (π n)
      rw [ih (by omega), hlt d n (by omega)]
  have hstep : ∀ d, N.run (sched d) (k + 1) = N.deliver (N.run π k) d := fun d => by
    show N.deliver (N.run (sched d) k) (sched d k) = _
    rw [hpre d k le_rfl, hk]
  have hfair : ∀ d, N.Fair (sched d) := by
    intro d n w u' r hr
    obtain ⟨j, hj⟩ := he (w, u', r)
    refine ⟨k + 1 + Nat.pair j n, ?_, N.mailbox_mono hP (sched d) ?_ hr⟩
    · rw [hgt, Nat.unpair_pair]
      exact hj
    · have := Nat.right_le_pair j n
      omega
  refine ⟨sched (a, u, t), sched (b, u, x), hfair _, hfair _,
    fun n hn => ⟨hlt _ n hn, hlt _ n hn⟩, ⟨k + 1, ?_⟩, ?_⟩
  · rw [hstep, N.deliver_apply, ite_eq_left ⟨ht, rfl⟩]
    refine Or.inr (hfire _ (Or.inr rfl) ?_)
    rintro (h | h)
    · exact hxL h
    · exact hxt h
  · have late : ∀ n, k + 1 ≤ n →
        x ∈ (N.run (sched (b, u, x)) n u).1 ∧ o ∉ (N.run (sched (b, u, x)) n u).2 := by
      intro n hn
      induction n, hn using Nat.le_induction with
      | base =>
        rw [hstep, N.deliver_apply, ite_eq_left ⟨hx, rfl⟩]
        refine ⟨Or.inl (Or.inr rfl), ?_⟩
        rintro (h | h)
        · exact ho h
        · exact hblock _ (Or.inr rfl) h
      | succ n _ ih =>
        obtain ⟨hxn, hon⟩ := ih
        show x ∈ (N.deliver (N.run (sched (b, u, x)) n) (sched (b, u, x) n) u).1 ∧
          o ∉ (N.deliver (N.run (sched (b, u, x)) n) (sched (b, u, x) n) u).2
        obtain ⟨w, u', r⟩ := sched (b, u, x) n
        rw [N.deliver_apply]
        split_ifs
        · refine ⟨Or.inl (Or.inl hxn), ?_⟩
          rintro (h | h)
          · exact hon h
          · exact hblock _ (Or.inl hxn) h
        · exact ⟨hxn, hon⟩
    intro n
    by_cases hn : n ≤ k
    · rw [hpre _ n hn]
      exact fun h => ho (N.emitted_mono π u hn h)
    · exact (late n (by omega)).2

end Cosys.Calco
