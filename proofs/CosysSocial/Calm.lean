import CosysCalco.Order
import CosysSocial.Grounding

/-!
# The CALM theorem for social facts

The claim of *Facts that ask for an absence* that the CALM theorem draws the same line through social
facts that it draws through programs, and the reply to objection D6 of *What Absence Costs*, read in
the network model of *Collaboration Is Composition* (`CosysCalco.Order`).

A unit's box can emit a fact record once the fact's grounding condition holds of the other records
in its log (`factOut`). When the condition asks only for records, that box is a monotone box, and
every fair schedule settles the same way on whether the unit emitted the fact (`positive_settles`).
When the condition asks for an absence, a unit asked the question at a moment, as the night nurse is
at two in the morning, can be scheduled so that it emits the fact or so that it never does
(`absence_splits`). `calm_social` puts the two together: over a countable type of records, a
condition whose absences show over finitely many records asks only for records exactly when it is
order free (`OrderFree`), that is when every network whose box answers it settles the same way under
every fair schedule.

The records of a network that asks a question are `Option (Option R)`: `some (some r)` is a record of
`R`, `some none` is the tick that asks the question, and `none` is the fact record.
-/

namespace Cosys.Social

open Cosys.Calco

variable {R ι : Type}

/-- The box of a fact: it emits the fact record `o` once `G` holds of the other records in its
log. -/
def factOut (G : Grounding R) (o : R) (X : Set R) : Set R := {r | r = o ∧ G (X \ {o})}

/-- A fact that asks only for records gives a monotone box. -/
theorem factOut_box {G : Grounding R} (hG : Positive G) (o : R) : MonotoneBox (factOut G o) := by
  constructor
  · intro X Y hXY r ⟨hr, hg⟩
    exact ⟨hr, hG (Set.sdiff_subset_sdiff_left hXY) hg⟩
  · intro X
    have h : (X ∪ factOut G o X) \ {o} = X \ {o} := by
      ext r
      simp only [factOut, Set.mem_sdiff, Set.mem_union, Set.mem_ofPred_eq, Set.mem_singleton_iff]
      constructor
      · rintro ⟨hr | ⟨hr, _⟩, hro⟩
        · exact ⟨hr, hro⟩
        · exact (hro hr).elim
      · rintro ⟨hr, hro⟩
        exact ⟨Or.inl hr, hro⟩
    show {r | r = o ∧ G ((X ∪ factOut G o X) \ {o})} = factOut G o X
    rw [h]
    rfl

/-- **Facts that ask only for records settle in any order.** If unit `u`'s box emits `o` once `G`
holds of its log and `G` asks only for records, every fair schedule settles on whether `u` emitted
`o`, and the answer is `G` read on `u`'s part of the least fixed point. -/
theorem positive_settles (N : LogNet ι R) (hbox : ∀ u, MonotoneBox (N.Out u))
    (h0 : ∀ u, N.Out u (N.L0 u) = ∅) (hP : ∀ w u, Monotone (N.pairs w u))
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E)
    {u : ι} {G : Grounding R} {o : R} (hu : N.Out u = factOut G o)
    (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    ∃ n, ∀ m, n ≤ m → (o ∈ (N.run σ m u).2 ↔ G (N.least hbox hP u \ {o})) := by
  obtain ⟨n, hn⟩ := order_unbounded N hbox h0 hP hfin σ hσ u
  refine ⟨n, fun m hm => ?_⟩
  rw [(N.inv_run hbox h0 σ m u).1, hu]
  change o ∈ factOut G o (N.logs σ m u) ↔ _
  rw [hn m hm]
  exact ⟨fun h => h.2, fun h => ⟨rfl, h⟩⟩

/-- The records of `R` in a log of a network that asks a question. -/
def recordsOf (X : Set (Option (Option R))) : Set R := {r | some (some r) ∈ X}

/-- A box that answers `G` when asked: it emits the fact record once the tick is in its log and `G`
holds of its records. -/
def askOut (G : Grounding R) (X : Set (Option (Option R))) : Set (Option (Option R)) :=
  {o | o = none ∧ some none ∈ X ∧ G (recordsOf X)}

/-- A box that answers a condition that asks only for records is a monotone box. -/
theorem askOut_box {G : Grounding R} (hG : Positive G) : MonotoneBox (askOut G) := by
  constructor
  · intro X Y hXY o ⟨ho, ht, hg⟩
    exact ⟨ho, hXY ht, hG (fun r hr => hXY hr) hg⟩
  · intro X
    have hrec : recordsOf (X ∪ askOut G X) = recordsOf X := by
      ext r
      constructor
      · rintro (h | ⟨h, _⟩)
        · exact h
        · exact (Option.some_ne_none _ h).elim
      · exact Or.inl
    show {o | o = none ∧ some none ∈ X ∪ askOut G X ∧ G (recordsOf (X ∪ askOut G X))} = askOut G X
    rw [hrec]
    ext o
    constructor
    · rintro ⟨ho, ht | ⟨h, _⟩, hg⟩
      · exact ⟨ho, ht, hg⟩
      · exact (Option.some_ne_none _ h).elim
    · rintro ⟨ho, ht, hg⟩
      exact ⟨ho, Or.inl ht, hg⟩

/-- An absence of `G`, when there is one, shows between two sets with finitely many records between
them. Every condition decided by finitely many records has this property. -/
def FiniteAbsence (G : Grounding R) : Prop :=
  AsksAbsence G → ∃ X Y, X ⊆ Y ∧ (Y \ X).Finite ∧ G X ∧ ¬ G Y

/-- Unit `u`'s box answers `G` on the logs that can arise: on every log that holds `u`'s initial log
and lies inside `Z`, the records that can reach a unit. This reads the box as `LogNet.within` reads
pairings. -/
def Answers (N : LogNet ι (Option (Option R))) (u : ι) (G : Grounding R)
    (Z : Set (Option (Option R))) : Prop :=
  ∀ X, N.L0 u ⊆ X → X ⊆ Z → N.Out u X = askOut G X

/-! ### The network of one unit asked a question -/

/-- The network that `absence_splits` builds from a record `r` that defeats a condition at `Z0`: one
unit that starts from the records of `Z0`, is offered `r` and the tick from outside, and emits the
fact once it holds the tick without `r`. -/
def splitNet (Z0 : Set R) (r : R) : LogNet Unit (Option (Option R)) where
  aud _ _ := False
  pairs _ _ _ := False
  Out _ X := {o | o = none ∧ some none ∈ X ∧ some (some r) ∉ X}
  L0 _ := (fun z => some (some z)) '' Z0
  In _ := {some (some r), some none}

/-- The records that can reach the unit of `splitNet`. -/
def splitZ (Z0 : Set R) (r : R) : Set (Option (Option R)) :=
  (fun z => some (some z)) '' Z0 ∪ {some (some r), some none} ∪ {none}

/-- Every log of `splitNet` holds the initial log and lies inside `splitZ`. -/
theorem splitNet_logs (Z0 : Set R) (r : R) (σ : ℕ → LogNet.Ev Unit (Option (Option R))) (n : ℕ) :
    (splitNet Z0 r).L0 () ⊆ (splitNet Z0 r).logs σ n () ∧
      (splitNet Z0 r).logs σ n () ⊆ splitZ Z0 r :=
  ⟨(splitNet Z0 r).logs_mono σ () (Nat.zero_le n),
    (((splitNet Z0 r).run_within (Z := splitZ Z0 r)
      (fun _ => Set.subset_union_left.trans Set.subset_union_left)
      (fun _ => Set.subset_union_right.trans Set.subset_union_left)
      (fun _ _ _ _ ho => Or.inr ho.1) σ n).2 ()).1⟩

/-- When `r` defeats `G` at `Z0`, the unit of `splitNet` answers `G` on every log that can arise. -/
theorem splitNet_answers {G : Grounding R} {Z0 : Set R} {r : R} (hZ0 : G Z0)
    (hr : ¬ G (insert r Z0)) : Answers (splitNet Z0 r) () G (splitZ Z0 r) := by
  intro X hL hXZ
  have hsub : recordsOf X ⊆ insert r Z0 := by
    intro z hz
    have h := hXZ hz
    simp only [splitZ, Set.mem_union, Set.mem_image, Set.mem_insert_iff, Set.mem_singleton_iff,
      Option.some.injEq, reduceCtorEq, or_false] at h
    rcases h with ⟨z', hz', rfl⟩ | rfl
    · exact Or.inr hz'
    · exact Or.inl rfl
  have hsup : Z0 ⊆ recordsOf X := fun z hz => hL (Set.mem_image_of_mem _ hz)
  have key : some (some r) ∉ X ↔ G (recordsOf X) := by
    by_cases h : some (some r) ∈ X
    · rw [Set.Subset.antisymm hsub (Set.insert_subset_iff.mpr ⟨h, hsup⟩)]
      exact ⟨fun h' => (h' h).elim, fun h' => (hr h').elim⟩
    · have he : recordsOf X = Z0 := by
        refine Set.Subset.antisymm (fun z hz => ?_) hsup
        rcases hsub hz with rfl | hz'
        · exact (h hz).elim
        · exact hz'
      rw [he]
      exact ⟨fun _ => hZ0, fun _ => h⟩
  ext o
  show (o = none ∧ some none ∈ X ∧ some (some r) ∉ X) ↔ (o = none ∧ some none ∈ X ∧ G (recordsOf X))
  rw [key]

/-- `splitNet` has two fair schedules: under one the unit emits the fact, under the other it never
does. This is `nonmono` of `CosysCalco.Order` at the start of a run. -/
theorem splitNet_schedules [Countable R] (Z0 : Set R) {r : R} (hrZ : r ∉ Z0) :
    ∃ σ τ : ℕ → LogNet.Ev Unit (Option (Option R)), (splitNet Z0 r).Fair σ ∧
      (splitNet Z0 r).Fair τ ∧ (∃ n, none ∈ ((splitNet Z0 r).run σ n ()).2) ∧
      ∀ n, none ∉ ((splitNet Z0 r).run τ n ()).2 := by
  obtain ⟨σ, τ, hσ, hτ, -, hfire, hnever⟩ := nonmono (splitNet Z0 r) (fun _ _ _ _ _ h => h)
    (fun _ => (none, (), none)) 0 (u := ()) (a := none) (b := none) (t := some none)
    (x := some (some r)) (o := none)
    (by simp [splitNet, LogNet.mailbox]) (by simp [splitNet, LogNet.mailbox]) (by simp)
    (by simpa [splitNet, LogNet.run, LogNet.init] using hrZ)
    (by simp [LogNet.run, LogNet.init])
    (fun _ ht hx => ⟨rfl, ht, hx⟩) (fun _ hx h => h.2.2 hx)
  exact ⟨σ, τ, hσ, hτ, hfire, hnever⟩

/-- **Facts that ask for an absence depend on the order.** If `G` holds of `X` and fails of a larger
`Y` with finitely many records between them, there is a network of one unit whose box answers `G` on
every log it can reach, and two fair schedules: under one the unit emits the fact, under the other
it never does. -/
theorem absence_splits [Countable R] {G : Grounding R} {X Y : Set R} (hXY : X ⊆ Y)
    (hfin : (Y \ X).Finite) (hX : G X) (hY : ¬ G Y) :
    ∃ (N : LogNet Unit (Option (Option R))) (σ τ : ℕ → LogNet.Ev Unit (Option (Option R))),
      (∀ n, N.Out () (N.logs σ n ()) = askOut G (N.logs σ n ())) ∧
      (∀ n, N.Out () (N.logs τ n ()) = askOut G (N.logs τ n ())) ∧
      N.Fair σ ∧ N.Fair τ ∧ (∃ n, none ∈ (N.run σ n ()).2) ∧ ∀ n, none ∉ (N.run τ n ()).2 := by
  obtain ⟨Z0, r, -, -, hrZ, hZ0, hr⟩ := absence_step hXY hfin hX hY
  obtain ⟨σ, τ, hσ, hτ, hfire, hnever⟩ := splitNet_schedules Z0 hrZ
  have hans := splitNet_answers hZ0 hr
  exact ⟨splitNet Z0 r, σ, τ,
    fun n => hans _ (splitNet_logs Z0 r σ n).1 (splitNet_logs Z0 r σ n).2,
    fun n => hans _ (splitNet_logs Z0 r τ n).1 (splitNet_logs Z0 r τ n).2,
    hσ, hτ, hfire, hnever⟩

/-- `G` is order free: in every network where unit `u`'s box answers `G` on the logs that can arise,
every other box is a monotone box, and the conditions of *Order independence* hold, any two fair
schedules eventually agree on whether `u` emitted the fact. The records that can reach a unit, `Z`,
hold every initial log, every outside input and every emission. -/
def OrderFree (G : Grounding R) : Prop :=
  ∀ (ι : Type) (N : LogNet ι (Option (Option R))) (u : ι) (Z : Set (Option (Option R))),
    (∀ v, N.L0 v ⊆ Z) → (∀ v, N.In v ⊆ Z) → (∀ v X, N.Out v X ⊆ Z) → Answers N u G Z →
    (∀ v, v ≠ u → MonotoneBox (N.Out v)) → (∀ v, N.Out v (N.L0 v) = ∅) →
    (∀ w v, Monotone (N.pairs w v)) →
    (∃ E : Set (Option (Option R)), E.Finite ∧ ∀ v, N.In v ⊆ E ∧ ∀ X, N.Out v X ⊆ E) →
    ∀ σ τ : ℕ → LogNet.Ev ι (Option (Option R)), N.Fair σ → N.Fair τ →
      ∃ n, ∀ m, n ≤ m → (none ∈ (N.run σ m u).2 ↔ none ∈ (N.run τ m u).2)

open Classical in
/-- `N` with unit `u`'s box replaced by the box that answers `G` on every log. -/
noncomputable def withAnswer (N : LogNet ι (Option (Option R))) (u : ι) (G : Grounding R) :
    LogNet ι (Option (Option R)) :=
  { N with Out := Function.update N.Out u (askOut G) }

open Classical in
theorem withAnswer_out (N : LogNet ι (Option (Option R))) (u : ι) (G : Grounding R) (v : ι)
    (X : Set (Option (Option R))) :
    (withAnswer N u G).Out v X = if v = u then askOut G X else N.Out v X := by
  show Function.update N.Out u (askOut G) v X = _
  by_cases hv : v = u
  · subst hv
    simp
  · simp [hv]

/-- **CALM for social facts**, in the model of *Collaboration Is Composition*. Over a countable type
of records, a grounding condition whose absences show over finitely many records asks only for
records exactly when every network whose box answers it settles the same way under every fair
schedule. -/
theorem calm_social [Countable R] (G : Grounding R) (hloc : FiniteAbsence G) :
    Positive G ↔ OrderFree G := by
  constructor
  · intro hG ι N u Z hZ0 hZi hZo hans hbox h0 hP hfin σ τ hσ hτ
    -- Replace `u`'s box by `askOut G`, a monotone box that agrees with it on every log that can
    -- arise, so that the runs are unchanged, and apply order independence to the result.
    set N' := withAnswer N u G with hN'
    have hbox' : ∀ v, MonotoneBox (N'.Out v) := by
      intro v
      by_cases hv : v = u
      · have : N'.Out v = askOut G := by
          funext X
          rw [withAnswer_out]; simp [hv]
        rw [this]
        exact askOut_box hG
      · have : N'.Out v = N.Out v := by
          funext X
          rw [withAnswer_out]; simp [hv]
        rw [this]
        exact hbox v hv
    have h0' : ∀ v, N'.Out v (N'.L0 v) = ∅ := by
      intro v
      rw [withAnswer_out]
      split_ifs with hv
      · subst hv
        exact (hans (N.L0 v) subset_rfl (hZ0 v)).symm.trans (h0 v)
      · exact h0 v
    have hP' : ∀ w v, Monotone (N'.pairs w v) := hP
    have hfin' : ∃ E : Set (Option (Option R)), E.Finite ∧
        ∀ v, N'.In v ⊆ E ∧ N'.Out v (N'.least hbox' hP' v) ⊆ E := by
      obtain ⟨E, hE, hEv⟩ := hfin
      refine ⟨insert none E, hE.insert none, fun v => ⟨(hEv v).1.trans (Set.subset_insert _ _), ?_⟩⟩
      rw [withAnswer_out]
      split_ifs
      · exact fun o ho => Or.inl ho.1
      · exact ((hEv v).2 _).trans (Set.subset_insert _ _)
    have hrunZ : ∀ (ρ : ℕ → LogNet.Ev ι (Option (Option R))) n v,
        (N.run ρ n v).1 ⊆ Z ∧ (N.run ρ n v).2 ⊆ Z :=
      fun ρ n v => (N.run_within hZ0 hZi (fun v X _ => hZo v X) ρ n).2 v
    have hrun : ∀ ρ n, N'.run ρ n = N.run ρ n := by
      intro ρ n
      induction n with
      | zero => rfl
      | succ n ih =>
        show N'.deliver (N'.run ρ n) (ρ n) = N.deliver (N.run ρ n) (ρ n)
        rw [ih]
        obtain ⟨w, u', r⟩ := ρ n
        funext v
        rw [N'.deliver_apply, N.deliver_apply]
        have hmb : N'.mailbox (N.run ρ n) w u' = N.mailbox (N.run ρ n) w u' := by
          cases w <;> rfl
        rw [hmb]
        split_ifs with h
        · obtain ⟨hr, rfl⟩ := h
          have hrZ : r ∈ Z := by
            cases w with
            | none => exact hZi _ hr
            | some w => exact (hrunZ ρ n w).2 hr.2.2
          have hX : (N.run ρ n v).1 ∪ {r} ⊆ Z :=
            Set.union_subset (hrunZ ρ n v).1 (Set.singleton_subset_iff.mpr hrZ)
          have hL : N.L0 v ⊆ (N.run ρ n v).1 ∪ {r} :=
            fun x hx => Or.inl (N.logs_mono ρ v (Nat.zero_le n) hx)
          have hO : N'.Out v ((N.run ρ n v).1 ∪ {r}) = N.Out v ((N.run ρ n v).1 ∪ {r}) := by
            rw [withAnswer_out]
            split_ifs with hv
            · subst hv
              exact (hans _ hL hX).symm
            · rfl
          show (_ ∪ _ ∪ N'.Out v _, _ ∪ N'.Out v _) = (_ ∪ _ ∪ N.Out v _, _ ∪ N.Out v _)
          rw [hO]
        · rfl
    have hmb' : ∀ x w v, N'.mailbox x w v = N.mailbox x w v := by
      intro x w v
      cases w <;> rfl
    have hfair : ∀ ρ, N.Fair ρ → N'.Fair ρ := by
      intro ρ hρ n w v r hr
      rw [hrun, hmb'] at hr
      obtain ⟨m, hm, hm'⟩ := hρ n w v r hr
      exact ⟨m, hm, by rw [hrun, hmb']; exact hm'⟩
    obtain ⟨n1, h1⟩ := order_unbounded N' hbox' h0' hP' hfin' σ (hfair σ hσ) u
    obtain ⟨n2, h2⟩ := order_unbounded N' hbox' h0' hP' hfin' τ (hfair τ hτ) u
    refine ⟨max n1 n2, fun m hm => ?_⟩
    have e : ∀ ρ, (N.run ρ m u).2 = N'.Out u (N'.logs ρ m u) := fun ρ => by
      rw [← hrun]
      exact (N'.inv_run hbox' h0' ρ m u).1
    rw [e σ, e τ, h1 m (le_of_max_le_left hm), h2 m (le_of_max_le_right hm)]
  · intro hOF
    refine (sort G).2 fun hA => ?_
    obtain ⟨X, Y, hXY, hfin, hX, hY⟩ := hloc hA
    obtain ⟨Z0, r, -, -, hrZ, hZ0, hr⟩ := absence_step hXY hfin hX hY
    obtain ⟨σ, τ, hσ, hτ, ⟨n1, h1⟩, hnever⟩ := splitNet_schedules Z0 hrZ
    have h0 : ∀ v, (splitNet Z0 r).Out v ((splitNet Z0 r).L0 v) = ∅ := by
      intro v
      ext o
      simp [splitNet]
    have hE : ({some (some r), some none, none} : Set (Option (Option R))).Finite :=
      ((Set.finite_singleton none).insert _).insert _
    obtain ⟨n, hn⟩ := hOF Unit (splitNet Z0 r) () (splitZ Z0 r)
      (fun _ => Set.subset_union_left.trans Set.subset_union_left)
      (fun _ => Set.subset_union_right.trans Set.subset_union_left)
      (fun _ _ _ ho => Or.inr ho.1) (splitNet_answers hZ0 hr) (fun v hv => (hv rfl).elim) h0
      (fun _ _ _ _ _ h => h)
      ⟨_, hE, fun _ => ⟨fun o ho => by rcases ho with rfl | rfl <;> simp,
        fun _ o ho => by rw [ho.1]; simp⟩⟩ σ τ hσ hτ
    exact hnever (max n n1)
      ((hn _ (le_max_left _ _)).1 ((splitNet Z0 r).emitted_mono σ () (le_max_right _ _) h1))

end Cosys.Social
