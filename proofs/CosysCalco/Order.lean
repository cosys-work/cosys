import Mathlib.Order.FixedPoints
import Mathlib.Order.OmegaCompletePartialOrder
import Mathlib.Data.Set.Finite.Basic
import Mathlib.Basic.Countable.Basic
import Mathlib.Data.Set.Card
import Mathlib.Data.Set.Finite.Range
import Mathlib.Data.Set.Finite.Lattice

/-!
# Order independence

The definition *Monotone box*, the theorem *Order independence*, the propositions on non-monotone
conditions and on growing wiring, and the proposition *Rounds are a fair schedule* of *Collaboration
Without Orchestration*.

A monotone box is log-determined, so we read it at the level of logs. `Out L` is the set of records
the box emits from the log `L`, and a box that receives `r` with log `L` emits `Out (L ∪ {r})` and
keeps `L ∪ {r}` and what it emitted. Each unit also keeps the set of records it has emitted.

The pairing in which `w` shares with `u` is read from `w`'s own log, as in the definition
*Collaboration with changing wiring*. With pairings that never change, the theorems are the
theorem *Order independence*. With pairings that only grow, because no revocation is emitted, they
are the proposition *Order independence with growing wiring*.

A record emitted by `w` sits in the mailbox from `w` to `u` while the pairing stands and `u` is in
its audience. Delivery does not remove it, so a schedule may deliver it more than once.

With finitely many records there are two scenarios. With finitely many units, every fair schedule
reaches the least fixed point and the network falls quiet there. With unboundedly many units, every
unit's log still settles on its part of the least fixed point, but the network as a whole may never
fall quiet: `no_global_quiescence` gives a fair schedule along which, at every step, some unit has
yet to receive a record.
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
  /-- What each unit's box emits from a log. -/
  Out : ι → Set R → Set R
  /-- The initial logs. -/
  L0 : ι → Set R

/-- The definition *Monotone box*: `Out` is monotone, and the box's own emissions add nothing to
what it emits, so the records it has emitted at any state are exactly `Out` of its log. -/
def MonotoneBox (Out : Set R → Set R) : Prop :=
  Monotone Out ∧ ∀ X, Out (X ∪ Out X) = Out X

namespace LogNet

variable (N : LogNet ι R)

/-- A unit's state: its log and the records it has emitted. -/
abbrev St (ι R : Type) := ι → Set R × Set R

/-- Every box starts from its initial log and emits what that log asks for. -/
def init : St ι R := fun u => (N.L0 u ∪ N.Out u (N.L0 u), N.Out u (N.L0 u))

/-- The mailbox from `w` to `u`. -/
def mailbox (x : St ι R) (w u : ι) : Set R :=
  {r | N.pairs w u (x w).1 ∧ N.aud r u ∧ r ∈ (x w).2}

/-- Unit `u` receives `r`. -/
def recv (u : ι) (p : Set R × Set R) (r : R) : Set R × Set R :=
  (p.1 ∪ {r} ∪ N.Out u (p.1 ∪ {r}), p.2 ∪ N.Out u (p.1 ∪ {r}))

/-- One step of a schedule: collect `r` from the mailbox from `w` to `u` and hand it to `u`. A
record that is not in that mailbox is not delivered. -/
noncomputable def deliver (x : St ι R) (d : ι × ι × R) : St ι R :=
  if d.2.2 ∈ N.mailbox x d.1 d.2.1 then Function.update x d.2.1 (N.recv d.2.1 (x d.2.1) d.2.2)
  else x

/-- The states along a schedule. -/
noncomputable def run (σ : ℕ → ι × ι × R) : ℕ → St ι R
  | 0 => N.init
  | n + 1 => N.deliver (run σ n) (σ n)

/-- The logs along a schedule. -/
noncomputable def logs (σ : ℕ → ι × ι × R) (n : ℕ) : ι → Set R := fun u => (N.run σ n u).1

/-- A schedule is fair when every record deposited in a mailbox is collected at some later step. -/
def Fair (σ : ℕ → ι × ι × R) : Prop :=
  ∀ n w u r, r ∈ N.mailbox (N.run σ n) w u → ∃ m, n ≤ m ∧ σ m = (w, u, r)

/-- The records deliverable to `u` when the units hold the logs `L`. -/
def deliverable (L : ι → Set R) (u : ι) : Set R :=
  {r | ∃ w, N.pairs w u (L w) ∧ N.aud r u ∧ r ∈ N.Out w (L w)}

/-- `F` adds to each log the initial records, the records that can be delivered to it, and what
its box emits. Its least fixed point is the least fixed point above the initial logs. -/
def F (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u)) :
    (ι → Set R) →o (ι → Set R) where
  toFun L u := N.L0 u ∪ N.deliverable L u ∪ N.Out u (L u)
  monotone' := by
    intro L L' h u r hr
    rcases hr with (hr | ⟨w, hw, ha, ho⟩) | hr
    · exact Or.inl (Or.inl hr)
    · exact Or.inl (Or.inr ⟨w, hP w u (h w) hw, ha, hOut w (h w) ho⟩)
    · exact Or.inr (hOut u (h u) hr)

/-- One round: every unit receives, as one set, everything deliverable to it. -/
def roundStep (L : ι → Set R) : ι → Set R := fun u =>
  (L u ∪ N.deliverable L u) ∪ N.Out u (L u ∪ N.deliverable L u)

/-- The logs after `n` rounds. -/
def rounds : ℕ → ι → Set R
  | 0 => fun u => (N.init u).1
  | n + 1 => N.roundStep (rounds n)

end LogNet

/-! ## Lemmas -/

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

namespace LogNet

variable (N : LogNet ι R)

/-- Each unit has emitted exactly `Out` of its log, and its log holds what it emitted. -/
def Inv (x : St ι R) : Prop := ∀ u, (x u).2 = N.Out u (x u).1 ∧ N.Out u (x u).1 ⊆ (x u).1

theorem deliver_apply (x : St ι R) (w u' : ι) (r : R) (u : ι) :
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

theorem inv_init (hbox : ∀ u, MonotoneBox (N.Out u)) : N.Inv N.init := by
  intro u
  have h := (hbox u).2 (N.L0 u)
  refine ⟨h.symm, ?_⟩
  show N.Out u (N.L0 u ∪ N.Out u (N.L0 u)) ⊆ N.L0 u ∪ N.Out u (N.L0 u)
  rw [h]
  exact Set.subset_union_right

theorem inv_recv (hbox : ∀ u, MonotoneBox (N.Out u)) {u : ι} {p : Set R × Set R}
    (hp : p.2 = N.Out u p.1) (r : R) :
    (N.recv u p r).2 = N.Out u (N.recv u p r).1 ∧ N.Out u (N.recv u p r).1 ⊆ (N.recv u p r).1 := by
  have h := (hbox u).2 (p.1 ∪ {r})
  have hm : N.Out u p.1 ⊆ N.Out u (p.1 ∪ {r}) := (hbox u).1 Set.subset_union_left
  simp only [recv]
  rw [h, hp, Set.union_eq_right.mpr hm]
  exact ⟨rfl, Set.subset_union_right⟩

theorem inv_deliver (hbox : ∀ u, MonotoneBox (N.Out u)) {x : St ι R} (hx : N.Inv x)
    (d : ι × ι × R) : N.Inv (N.deliver x d) := by
  obtain ⟨w, u', r⟩ := d
  intro u
  rw [deliver_apply]
  split_ifs
  · exact N.inv_recv hbox (hx u).1 r
  · exact hx u

theorem inv_run (hbox : ∀ u, MonotoneBox (N.Out u)) (σ : ℕ → ι × ι × R) (n : ℕ) :
    N.Inv (N.run σ n) := by
  induction n with
  | zero => exact N.inv_init hbox
  | succ n ih => exact N.inv_deliver hbox ih (σ n)

theorem log_le_deliver (x : St ι R) (d : ι × ι × R) (u : ι) :
    (x u).1 ⊆ (N.deliver x d u).1 := by
  obtain ⟨w, u', r⟩ := d
  rw [deliver_apply]
  split_ifs
  · intro s hs
    exact Or.inl (Or.inl hs)
  · exact subset_rfl

theorem logs_mono (σ : ℕ → ι × ι × R) (u : ι) : Monotone fun n => N.logs σ n u :=
  monotone_nat_of_le_succ fun n => N.log_le_deliver (N.run σ n) (σ n) u

theorem logs_mono' (σ : ℕ → ι × ι × R) : Monotone (N.logs σ) :=
  fun _ _ h u => N.logs_mono σ u h

theorem deliverable_mono {L L' : ι → Set R} (hOut : ∀ u, Monotone (N.Out u))
    (hP : ∀ w u, Monotone (N.pairs w u)) (h : L ≤ L') (u : ι) :
    N.deliverable L u ⊆ N.deliverable L' u :=
  fun _ ⟨w, hw, ha, ho⟩ => ⟨w, hP w u (h w) hw, ha, hOut w (h w) ho⟩

theorem lfp_closed (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u)) (u : ι) :
    N.L0 u ∪ N.deliverable (lfp (N.F hOut hP)) u ∪ N.Out u (lfp (N.F hOut hP) u) ⊆
      lfp (N.F hOut hP) u :=
  (congrFun (OrderHom.map_lfp (N.F hOut hP)) u).le

theorem init_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (u : ι) : (N.init u).1 ⊆ lfp (N.F (fun u => (hbox u).1) hP) u := by
  have hc := N.lfp_closed (fun u => (hbox u).1) hP u
  have h0 : N.L0 u ⊆ lfp (N.F (fun u => (hbox u).1) hP) u := fun r hr => hc (Or.inl (Or.inl hr))
  exact Set.union_subset h0 fun r hr => hc (Or.inr ((hbox u).1 h0 hr))

theorem deliver_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    {x : St ι R} (hx : ∀ u, (x u).1 ⊆ lfp (N.F (fun u => (hbox u).1) hP) u) (hinv : N.Inv x)
    (d : ι × ι × R) (u : ι) : (N.deliver x d u).1 ⊆ lfp (N.F (fun u => (hbox u).1) hP) u := by
  obtain ⟨w, u', r⟩ := d
  rw [deliver_apply]
  split_ifs with h
  · obtain ⟨⟨hpw, ha, hs⟩, rfl⟩ := h
    have hc := N.lfp_closed (fun u => (hbox u).1) hP u
    have hs' : r ∈ N.Out w (x w).1 := (hinv w).1 ▸ hs
    have hrM : r ∈ lfp (N.F (fun u => (hbox u).1) hP) u :=
      hc (Or.inl (Or.inr ⟨w, hP w u (hx w) hpw, ha, (hbox w).1 (hx w) hs'⟩))
    have hX : (x u).1 ∪ {r} ⊆ lfp (N.F (fun u => (hbox u).1) hP) u :=
      Set.union_subset (hx u) (Set.singleton_subset_iff.mpr hrM)
    show (x u).1 ∪ {r} ∪ N.Out u ((x u).1 ∪ {r}) ⊆ _
    exact Set.union_subset hX fun s hs => hc (Or.inr ((hbox u).1 hX hs))
  · exact hx u

theorem run_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (σ : ℕ → ι × ι × R) (n : ℕ) (u : ι) :
    N.logs σ n u ⊆ lfp (N.F (fun u => (hbox u).1) hP) u := by
  induction n generalizing u with
  | zero => exact N.init_le_lfp hbox hP u
  | succ n ih => exact N.deliver_le_lfp hbox hP ih (N.inv_run hbox σ n) (σ n) u

theorem deliver_bound {E : Set R}
    (hE : ∀ u X, N.Out u X ⊆ E) {x : St ι R} (hx : ∀ u, (x u).1 ⊆ (N.init u).1 ∪ E)
    (hinv : N.Inv x) (d : ι × ι × R) (u : ι) : (N.deliver x d u).1 ⊆ (N.init u).1 ∪ E := by
  obtain ⟨w, u', r⟩ := d
  rw [deliver_apply]
  split_ifs with h
  · obtain ⟨⟨-, -, hs⟩, rfl⟩ := h
    have hs' : r ∈ N.Out w (x w).1 := (hinv w).1 ▸ hs
    show (x u).1 ∪ {r} ∪ N.Out u ((x u).1 ∪ {r}) ⊆ _
    refine Set.union_subset (Set.union_subset (hx u) ?_) fun s hs => Or.inr (hE u _ hs)
    exact Set.singleton_subset_iff.mpr (Or.inr (hE w _ hs'))
  · exact hx u

theorem run_bound (hbox : ∀ u, MonotoneBox (N.Out u)) {E : Set R} (hE : ∀ u X, N.Out u X ⊆ E)
    (σ : ℕ → ι × ι × R) (n : ℕ) (u : ι) : N.logs σ n u ⊆ N.logs σ 0 u ∪ E := by
  induction n generalizing u with
  | zero => exact Set.subset_union_left
  | succ n ih => exact N.deliver_bound hE ih (N.inv_run hbox σ n) (σ n) u

theorem mailbox_mono (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (σ : ℕ → ι × ι × R) {n m : ℕ} (h : n ≤ m) {w u : ι} {r : R}
    (hr : r ∈ N.mailbox (N.run σ n) w u) : r ∈ N.mailbox (N.run σ m) w u := by
  obtain ⟨hp, ha, hs⟩ := hr
  have hl := N.logs_mono σ w h
  refine ⟨hP w u hl hp, ha, ?_⟩
  rw [(N.inv_run hbox σ m w).1]
  rw [(N.inv_run hbox σ n w).1] at hs
  exact (hbox w).1 hl hs

theorem run_delivers (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (σ : ℕ → ι × ι × R) (hσ : N.Fair σ) {n : ℕ} {w u : ι} {r : R}
    (hp : N.pairs w u (N.logs σ n w)) (ha : N.aud r u) (ho : r ∈ N.Out w (N.logs σ n w)) :
    ∃ m, r ∈ N.logs σ m u := by
  have hmb : r ∈ N.mailbox (N.run σ n) w u := by
    refine ⟨hp, ha, ?_⟩
    rw [(N.inv_run hbox σ n w).1]
    exact ho
  obtain ⟨m, hnm, hσm⟩ := hσ n w u r hmb
  have hmb' := N.mailbox_mono hbox hP σ hnm hmb
  refine ⟨m + 1, ?_⟩
  show r ∈ (N.deliver (N.run σ m) (σ m) u).1
  rw [hσm, deliver_apply, ite_eq_left ⟨hmb', rfl⟩]
  exact Or.inl (Or.inr rfl)

/-- The union of an increasing sequence of logs is the least fixed point, when it starts above the
initial logs, stays below the fixed point, keeps every log closed under its box, delivers whatever
can be delivered, and reaches every pairing and emission of the union at a finite stage. -/
theorem union_eq_lfp (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (f : ℕ → ι → Set R) (hle : ∀ n u, f n u ⊆ lfp (N.F hOut hP) u) (h0 : ∀ u, N.L0 u ⊆ f 0 u)
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
    · exact Set.mem_iUnion.mpr ⟨0, h0 u hr⟩
    · obtain ⟨n, hpn, hon⟩ := hcP w u r hp ho
      obtain ⟨m, hm⟩ := hdel n w u r hpn ha hon
      exact Set.mem_iUnion.mpr ⟨m, hm⟩
    · obtain ⟨n, hn⟩ := hcO u r hr
      exact Set.mem_iUnion.mpr ⟨n, hclosed n u hn⟩

/-- `union_eq_lfp` when every unit's log settles. -/
theorem union_eq_lfp_settled (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (f : ℕ → ι → Set R) (hmono : ∀ u, Monotone fun n => f n u)
    (hle : ∀ n u, f n u ⊆ lfp (N.F hOut hP) u) (h0 : ∀ u, N.L0 u ⊆ f 0 u)
    (hclosed : ∀ n u, N.Out u (f n u) ⊆ f n u)
    (hdel : ∀ n w u r, N.pairs w u (f n w) → N.aud r u → r ∈ N.Out w (f n w) → ∃ m, r ∈ f m u)
    (hset : ∀ u, ∃ n, ∀ m, n ≤ m → f m u = f n u) :
    (fun u => ⋃ n, f n u) = lfp (N.F hOut hP) := by
  have hU : ∀ u, ∃ n, (⋃ m, f m u) = f n u := fun u =>
    let ⟨n, hn⟩ := hset u
    ⟨n, union_of_settled (hmono u) hn⟩
  refine N.union_eq_lfp hOut hP f hle h0 hclosed hdel ?_ ?_
  · intro w u r hp ho
    obtain ⟨n, hn⟩ := hU w
    rw [hn] at hp ho
    exact ⟨n, hp, ho⟩
  · intro u r hr
    obtain ⟨n, hn⟩ := hU u
    rw [hn] at hr
    exact ⟨n, hr⟩

/-- `union_eq_lfp` when the boxes and the pairings preserve unions of increasing chains. -/
theorem union_eq_lfp_chain (hOut : ∀ u, Monotone (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (hOc : ∀ u, ωScottContinuous (N.Out u)) (hPc : ∀ w u, ωScottContinuous (N.pairs w u))
    (f : ℕ → ι → Set R) (hmono : ∀ u, Monotone fun n => f n u)
    (hle : ∀ n u, f n u ⊆ lfp (N.F hOut hP) u) (h0 : ∀ u, N.L0 u ⊆ f 0 u)
    (hclosed : ∀ n u, N.Out u (f n u) ⊆ f n u)
    (hdel : ∀ n w u r, N.pairs w u (f n w) → N.aud r u → r ∈ N.Out w (f n w) → ∃ m, r ∈ f m u) :
    (fun u => ⋃ n, f n u) = lfp (N.F hOut hP) := by
  refine N.union_eq_lfp hOut hP f hle h0 hclosed hdel ?_ ?_
  · intro w u r hp ho
    obtain ⟨n₁, hn₁⟩ := cont_prop (hPc w u) _ (hmono w) hp
    rw [cont_iUnion (hOc w) _ (hmono w)] at ho
    obtain ⟨n₂, hn₂⟩ := Set.mem_iUnion.mp ho
    refine ⟨max n₁ n₂, hP w u (hmono w (le_max_left _ _)) hn₁, ?_⟩
    exact hOut w (hmono w (le_max_right _ _)) hn₂
  · intro u r hr
    rw [cont_iUnion (hOc u) _ (hmono u)] at hr
    exact Set.mem_iUnion.mp hr

/-! ### Rounds -/

theorem rounds_mono (u : ι) : Monotone fun n => N.rounds n u :=
  monotone_nat_of_le_succ fun _ _ hr => Or.inl (Or.inl hr)

theorem rounds_closed (hbox : ∀ u, MonotoneBox (N.Out u)) (n : ℕ) (u : ι) :
    N.Out u (N.rounds n u) ⊆ N.rounds n u := by
  cases n with
  | zero => exact (N.inv_init hbox u).2
  | succ n =>
    show N.Out u (N.roundStep (N.rounds n) u) ⊆ N.roundStep (N.rounds n) u
    unfold roundStep
    rw [(hbox u).2]
    exact Set.subset_union_right

theorem rounds_le_lfp (hbox : ∀ u, MonotoneBox (N.Out u)) (hP : ∀ w u, Monotone (N.pairs w u))
    (n : ℕ) (u : ι) : N.rounds n u ⊆ lfp (N.F (fun u => (hbox u).1) hP) u := by
  induction n generalizing u with
  | zero => exact N.init_le_lfp hbox hP u
  | succ n ih =>
    have hc := N.lfp_closed (fun u => (hbox u).1) hP u
    have hX : N.rounds n u ∪ N.deliverable (N.rounds n) u ⊆
        lfp (N.F (fun u => (hbox u).1) hP) u :=
      Set.union_subset (ih u) fun r hr =>
        hc (Or.inl (Or.inr (N.deliverable_mono (fun u => (hbox u).1) hP ih u hr)))
    exact Set.union_subset hX fun r hr => hc (Or.inr ((hbox u).1 hX hr))

theorem rounds_bound {E : Set R} (hE : ∀ u X, N.Out u X ⊆ E)
    (n : ℕ) (u : ι) : N.rounds n u ⊆ N.rounds 0 u ∪ E := by
  induction n generalizing u with
  | zero => exact Set.subset_union_left
  | succ n ih =>
    refine Set.union_subset (Set.union_subset (ih u) ?_) fun s hs => Or.inr (hE u _ hs)
    rintro r ⟨w, -, -, ho⟩
    exact Or.inr (hE w _ ho)

theorem rounds_delivers {n : ℕ} {w u : ι} {r : R} (hp : N.pairs w u (N.rounds n w))
    (ha : N.aud r u) (ho : r ∈ N.Out w (N.rounds n w)) : ∃ m, r ∈ N.rounds m u :=
  ⟨n + 1, Or.inl (Or.inr ⟨w, hp, ha, ho⟩)⟩

end LogNet

section theorems

variable (N : LogNet ι R) (hbox : ∀ u, MonotoneBox (N.Out u))
  (hP : ∀ w u, Monotone (N.pairs w u))

/-- **Order independence (ii), unboundedly many units.** With finitely many records that can ever
be emitted and any number of units, every unit's log settles, along every fair schedule, on its
component of the least fixed point above the initial logs. -/
theorem order_unbounded (hfin : ∃ E : Set R, E.Finite ∧ ∀ u X, N.Out u X ⊆ E)
    (σ : ℕ → ι × ι × R) (hσ : N.Fair σ) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = lfp (N.F (fun u => (hbox u).1) hP) u := by
  obtain ⟨E, hE, hOE⟩ := hfin
  have hset : ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = N.logs σ n u := fun u =>
    sets_settle (N.logs_mono σ u) hE fun n => N.run_bound hbox hOE σ n u
  have hlim := N.union_eq_lfp_settled (fun u => (hbox u).1) hP (N.logs σ) (N.logs_mono σ)
    (N.run_le_lfp hbox hP σ) (fun _ _ hr => Or.inl hr) (fun n u => (N.inv_run hbox σ n u).2)
    (fun _ _ _ _ hp ha ho => N.run_delivers hbox hP σ hσ hp ha ho) hset
  intro u
  obtain ⟨n, hn⟩ := hset u
  refine ⟨n, fun m hm => ?_⟩
  rw [hn m hm, ← union_of_settled (N.logs_mono σ u) hn]
  exact congrFun hlim u

include hbox hP in
/-- **Order independence (ii), unboundedly many units**, for two schedules: unit by unit, any two
fair schedules settle on the same log. -/
theorem order_unbounded_agree (hfin : ∃ E : Set R, E.Finite ∧ ∀ u X, N.Out u X ⊆ E)
    (σ τ : ℕ → ι × ι × R) (hσ : N.Fair σ) (hτ : N.Fair τ) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.logs σ m u = N.logs τ m u := by
  intro u
  obtain ⟨n₁, h₁⟩ := order_unbounded N hbox hP hfin σ hσ u
  obtain ⟨n₂, h₂⟩ := order_unbounded N hbox hP hfin τ hτ u
  exact ⟨max n₁ n₂, fun m hm =>
    (h₁ m (le_trans (le_max_left _ _) hm)).trans (h₂ m (le_trans (le_max_right _ _) hm)).symm⟩

/-- **Order independence (i).** With finitely many units and finitely many records that can ever
be emitted, every fair schedule reaches the least fixed point above the initial logs and stays
there. -/
theorem order_finite [Finite ι] (hfin : ∃ E : Set R, E.Finite ∧ ∀ u X, N.Out u X ⊆ E)
    (σ : ℕ → ι × ι × R) (hσ : N.Fair σ) :
    ∃ n, ∀ m, n ≤ m → N.logs σ m = lfp (N.F (fun u => (hbox u).1) hP) := by
  choose k hk using order_unbounded N hbox hP hfin σ hσ
  obtain ⟨K, hK⟩ := (Set.finite_range k).bddAbove
  refine ⟨K, fun m hm => funext fun u => hk u m ?_⟩
  exact le_trans (hK ⟨u, rfl⟩) hm

include hbox hP in
/-- **Order independence (i)**, for two schedules: any two fair schedules reach the same logs and
stay there, and so agree on any view that is a function of the logs. -/
theorem order_finite_agree [Finite ι] (hfin : ∃ E : Set R, E.Finite ∧ ∀ u X, N.Out u X ⊆ E)
    (σ τ : ℕ → ι × ι × R) (hσ : N.Fair σ) (hτ : N.Fair τ) :
    ∃ n, ∀ m, n ≤ m → N.logs σ m = N.logs τ m := by
  obtain ⟨n₁, h₁⟩ := order_finite N hbox hP hfin σ hσ
  obtain ⟨n₂, h₂⟩ := order_finite N hbox hP hfin τ hτ
  exact ⟨max n₁ n₂, fun m hm =>
    (h₁ m (le_trans (le_max_left _ _) hm)).trans (h₂ m (le_trans (le_max_right _ _) hm)).symm⟩

/-- **Order independence (iii).** When each box's `Out`, and each pairing as a function of the
sender's log, preserve unions of increasing chains, the union of the logs along every fair schedule
is the least fixed point above the initial logs. -/
theorem order_chain (hOut : ∀ u, ωScottContinuous (N.Out u))
    (hPc : ∀ w u, ωScottContinuous (N.pairs w u)) (σ : ℕ → ι × ι × R) (hσ : N.Fair σ) :
    (fun u => ⋃ n, N.logs σ n u) = lfp (N.F (fun u => (hbox u).1) hP) :=
  N.union_eq_lfp_chain (fun u => (hbox u).1) hP hOut hPc (N.logs σ) (N.logs_mono σ)
    (N.run_le_lfp hbox hP σ) (fun _ _ hr => Or.inl hr) (fun n u => (N.inv_run hbox σ n u).2)
    (fun _ _ _ _ hp ha ho => N.run_delivers hbox hP σ hσ hp ha ho)

/-- **Rounds are a fair schedule**, unboundedly many units: every unit's log settles over the rounds
on its component of the same least fixed point. -/
theorem rounds_unbounded (hfin : ∃ E : Set R, E.Finite ∧ ∀ u X, N.Out u X ⊆ E) :
    ∀ u, ∃ n, ∀ m, n ≤ m → N.rounds m u = lfp (N.F (fun u => (hbox u).1) hP) u := by
  obtain ⟨E, hE, hOE⟩ := hfin
  have hset : ∀ u, ∃ n, ∀ m, n ≤ m → N.rounds m u = N.rounds n u := fun u =>
    sets_settle (N.rounds_mono u) hE fun n => N.rounds_bound hOE n u
  have hlim := N.union_eq_lfp_settled (fun u => (hbox u).1) hP N.rounds N.rounds_mono
    (N.rounds_le_lfp hbox hP) (fun _ _ hr => Or.inl hr) (N.rounds_closed hbox)
    (fun _ _ _ _ hp ha ho => N.rounds_delivers hp ha ho) hset
  intro u
  obtain ⟨n, hn⟩ := hset u
  refine ⟨n, fun m hm => ?_⟩
  rw [hn m hm, ← union_of_settled (N.rounds_mono u) hn]
  exact congrFun hlim u

/-- **Rounds are a fair schedule**, finite case: running in rounds reaches the same logs as every
fair schedule in `order_finite`. -/
theorem rounds_finite [Finite ι] (hfin : ∃ E : Set R, E.Finite ∧ ∀ u X, N.Out u X ⊆ E) :
    ∃ n, ∀ m, n ≤ m → N.rounds m = lfp (N.F (fun u => (hbox u).1) hP) := by
  choose k hk using rounds_unbounded N hbox hP hfin
  obtain ⟨K, hK⟩ := (Set.finite_range k).bddAbove
  refine ⟨K, fun m hm => funext fun u => hk u m ?_⟩
  exact le_trans (hK ⟨u, rfl⟩) hm

/-- **Rounds are a fair schedule**, chain case: the union of the logs over all rounds is the same
least fixed point as in `order_chain`. -/
theorem rounds_chain (hOut : ∀ u, ωScottContinuous (N.Out u))
    (hPc : ∀ w u, ωScottContinuous (N.pairs w u)) :
    (fun u => ⋃ n, N.rounds n u) = lfp (N.F (fun u => (hbox u).1) hP) :=
  N.union_eq_lfp_chain (fun u => (hbox u).1) hP hOut hPc N.rounds N.rounds_mono
    (N.rounds_le_lfp hbox hP) (fun _ _ hr => Or.inl hr) (N.rounds_closed hbox)
    (fun _ _ _ _ hp ha ho => N.rounds_delivers hp ha ho)

end theorems

/-- **No global quiescence.** There is a network with infinitely many units, monotone boxes,
pairings that never change and a single record, and a fair schedule along which the logs are never
the least fixed point: at every step some unit has yet to receive the record. Each unit's log still
settles, by `order_unbounded`. -/
theorem no_global_quiescence :
    ∃ (N : LogNet ℕ Unit) (hbox : ∀ u, MonotoneBox (N.Out u))
      (hP : ∀ w u, Monotone (N.pairs w u)) (σ : ℕ → ℕ × ℕ × Unit),
      N.Fair σ ∧ ∀ n, N.logs σ n ≠ lfp (N.F (fun u => (hbox u).1) hP) := by
  let N : LogNet ℕ Unit :=
    { aud := fun _ _ => True
      pairs := fun w _ _ => w = 0
      Out := fun _ X => X
      L0 := fun u => if u = 0 then Set.univ else ∅ }
  have hbox : ∀ u, MonotoneBox (N.Out u) := fun _ => ⟨monotone_id, fun X => Set.union_self X⟩
  have hP : ∀ w u, Monotone (N.pairs w u) := fun _ _ => monotone_const
  let σ : ℕ → ℕ × ℕ × Unit := fun m => (0, (Nat.unpair m).1, ())
  refine ⟨N, hbox, hP, σ, ?_, ?_⟩
  · intro n w u r hr
    have hw : w = 0 := hr.1
    subst hw
    refine ⟨Nat.pair u n, Nat.right_le_pair u n, ?_⟩
    show (0, (Nat.unpair (Nat.pair u n)).1, ()) = (0, u, r)
    rw [Nat.unpair_pair]
  · have key : ∀ n u, u ≠ 0 → () ∈ N.logs σ n u → ∃ m, m < n ∧ (Nat.unpair m).1 = u := by
      intro n
      induction n with
      | zero =>
        intro u hu h
        have h' : () ∈ N.L0 u ∪ N.L0 u := h
        simp only [N, ite_eq_right hu, Set.union_empty] at h'
        exact h'.elim
      | succ n ih =>
        intro u hu h
        have h' : () ∈ (N.deliver (N.run σ n) (0, (Nat.unpair n).1, ()) u).1 := h
        rw [LogNet.deliver_apply] at h'
        split_ifs at h' with hc
        · exact ⟨n, Nat.lt_succ_self n, hc.2.symm⟩
        · obtain ⟨m, hm, hmu⟩ := ih u hu h'
          exact ⟨m, Nat.lt_succ_of_lt hm, hmu⟩
    intro n heq
    have h0 : () ∈ lfp (N.F (fun u => (hbox u).1) hP) 0 :=
      N.lfp_closed (fun u => (hbox u).1) hP 0 (Or.inl (Or.inl (by simp [N])))
    have hM : () ∈ lfp (N.F (fun u => (hbox u).1) hP) (n + 1) :=
      N.lfp_closed (fun u => (hbox u).1) hP (n + 1) (Or.inl (Or.inr ⟨0, rfl, trivial, h0⟩))
    rw [← heq] at hM
    obtain ⟨m, hm, hmu⟩ := key n (n + 1) (Nat.succ_ne_zero n) hM
    have := Nat.unpair_left_le m
    omega

/-- **A non-monotone condition depends on the order.** Suppose unit `u` emits `o` once it holds the
trigger `t` without the objection `x`, and never emits `o` while it holds `x`, as with "no objection
by the deadline" or "not revoked". If both `t` and `x` are waiting in `u`'s mailboxes at the start,
then there are two fair schedules: under one, `u` emits `o`; under the other, it never does. -/
theorem nonmono [Countable ι] [Countable R] (N : LogNet ι R) {u a b : ι} {t x o : R}
    (ht : t ∈ N.mailbox N.init a u) (hx : x ∈ N.mailbox N.init b u) (hxt : x ≠ t)
    (hxL : x ∉ (N.init u).1) (ho : o ∉ (N.init u).2)
    (hfire : ∀ X, t ∈ X → x ∉ X → o ∈ N.Out u X) (hblock : ∀ X, x ∈ X → o ∉ N.Out u X) :
    ∃ σ τ, N.Fair σ ∧ N.Fair τ ∧ (∃ n, o ∈ (N.run σ n u).2) ∧ ∀ n, o ∉ (N.run τ n u).2 := by
  have : Nonempty (ι × ι × R) := ⟨(a, u, t)⟩
  obtain ⟨e, he⟩ := exists_surjective_nat (ι × ι × R)
  let sched : ι × ι × R → ℕ → ι × ι × R := fun d n => n.casesOn d fun k => e (Nat.unpair k).1
  have hfair : ∀ d, N.Fair (sched d) := by
    intro d n w u' r _
    obtain ⟨k, hk⟩ := he (w, u', r)
    refine ⟨Nat.pair k n + 1, by have := Nat.right_le_pair k n; omega, ?_⟩
    show e (Nat.unpair (Nat.pair k n)).1 = (w, u', r)
    rw [Nat.unpair_pair]
    exact hk
  refine ⟨sched (a, u, t), sched (b, u, x), hfair _, hfair _, ⟨1, ?_⟩, ?_⟩
  · show o ∈ (N.deliver N.init (a, u, t) u).2
    rw [N.deliver_apply, ite_eq_left ⟨ht, rfl⟩]
    refine Or.inr (hfire _ (Or.inr rfl) ?_)
    rintro (h | h)
    · exact hxL h
    · exact hxt h
  · have key : ∀ n, o ∉ (N.run (sched (b, u, x)) n u).2 ∧
        (0 < n → x ∈ (N.run (sched (b, u, x)) n u).1) := by
      intro n
      induction n with
      | zero => exact ⟨ho, fun h => absurd h (Nat.lt_irrefl 0)⟩
      | succ n ih =>
        rcases n with _ | k
        · show o ∉ (N.deliver N.init (b, u, x) u).2 ∧ (0 < 1 → x ∈ (N.deliver N.init (b, u, x) u).1)
          rw [N.deliver_apply, ite_eq_left ⟨hx, rfl⟩]
          refine ⟨?_, fun _ => Or.inl (Or.inr rfl)⟩
          rintro (h | h)
          · exact ho h
          · exact hblock _ (Or.inr rfl) h
        · obtain ⟨ho', hx'⟩ := ih
          have hxk := hx' (Nat.succ_pos k)
          show o ∉ (N.deliver (N.run (sched (b, u, x)) (k + 1)) (sched (b, u, x) (k + 1)) u).2 ∧
            (0 < k + 2 →
              x ∈ (N.deliver (N.run (sched (b, u, x)) (k + 1)) (sched (b, u, x) (k + 1)) u).1)
          obtain ⟨w, u', r⟩ := sched (b, u, x) (k + 1)
          rw [N.deliver_apply]
          split_ifs
          · refine ⟨?_, fun _ => Or.inl (Or.inl hxk)⟩
            rintro (h | h)
            · exact ho' h
            · exact hblock _ (Or.inl hxk) h
          · exact ⟨ho', fun _ => hxk⟩
    exact fun n => (key n).1

end Cosys.Calco
