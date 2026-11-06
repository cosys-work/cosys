import CosysCore.Basic

/-!
# Units, routing and the changing wiring

The proposition *A unit with its mailboxes is a dynamical system* and the theorem *Changing
wiring as a map of polynomials* of *Collaboration Without Orchestration*.

An envelope is a record together with one unit in its audience: `src` is the unit whose box
emitted it and `dst` the unit it is for. A box emits a record addressed to several units as one
envelope for each. Collaborations run in rounds, and in each round a box takes the envelopes
delivered to it as one set. A unit holds an envelope it emitted until the pairing to its recipient
stands, and the round in which it is delivered is the last round it is held, so each envelope is
delivered once.

For a set `W` of units, a position of the interface `p_W` is a pair `(P, D)`: `P` holds the
standing pairings from members of `W` to units outside it, and `D` the envelopes deposited for
units outside `W`. A direction is a set of envelopes for members of `W`.
-/

namespace Cosys

/-- Units and envelopes. -/
structure Net where
  U : Type
  E : Type
  src : E → U
  dst : E → U

namespace Net

variable (N : Net)

/-- A position of `p_W`: the pairings and the deposits that leave `W`. `P a b` says that the
pairing in which `a` shares with `b` stands. -/
structure Pos (W : Pred N.U) where
  P : N.U → N.U → Prop
  D : Pred N.E
  P_out : ∀ a b, P a b → W a ∧ ¬ W b
  D_out : ∀ e, D e → W (N.src e) ∧ ¬ W (N.dst e)

/-- A direction of `p_W`: a set of envelopes for members of `W`. -/
def Dir (W : Pred N.U) : Type := {X : Pred N.E // ∀ e, X e → W (N.dst e)}

/-- The interface `p_W = Σ (P, D), y^Dir(W)`. -/
@[reducible] def iface (W : Pred N.U) : Poly where
  pos := N.Pos W
  dir _ := N.Dir W

/-- Positions are equal when they show the same pairings and deposits. -/
theorem Pos.ext {W : Pred N.U} {x y : N.Pos W} (hP : ∀ a b, x.P a b ↔ y.P a b)
    (hD : ∀ e, x.D e ↔ y.D e) : x = y := by
  obtain ⟨P, D, _, _⟩ := x
  obtain ⟨P', D', _, _⟩ := y
  have h1 : P = P' := funext fun a => funext fun b => propext (hP a b)
  have h2 : D = D' := funext fun e => propext (hD e)
  subst h1
  subst h2
  rfl

/-- Directions are equal when they hold the same envelopes. -/
theorem Dir.ext {W : Pred N.U} {X Y : N.Dir W} (h : ∀ e, X.1 e ↔ Y.1 e) : X = Y :=
  Subtype.ext (funext fun e => propext (h e))

/-- Nothing arrives. -/
def Dir.empty (W : Pred N.U) : N.Dir W := ⟨fun _ => False, fun _ h => h.elim⟩

variable {N}

/-- Routing for `W = ⨆ G i`, with `pair I a b` saying whether the pairing in which `a` shares with
`b` stands when the groups show `I`. Forward, it keeps the pairings and deposits that leave `W`.
Backward, group `i` gets what arrives from outside for its members, and every envelope a group
deposited for one of its members along a standing pairing. -/
def route {W : Pred N.U} {ι : Type} (G : Partition W ι)
    (pair : (Poly.tensor fun i => N.iface (G.part i)).pos → N.U → N.U → Prop) :
    Poly.Hom (Poly.tensor fun i => N.iface (G.part i)) (N.iface W) where
  onPos I :=
    { P := fun a b => (∃ i, (I i).P a b) ∧ ¬ W b
      D := fun e => (∃ i, (I i).D e) ∧ ¬ W (N.dst e)
      P_out := fun a b h => match h with
        | ⟨⟨i, hi⟩, hb⟩ => ⟨G.sub i a ((I i).P_out a b hi).1, hb⟩
      D_out := fun e h => match h with
        | ⟨⟨i, hi⟩, hd⟩ => ⟨G.sub i _ ((I i).D_out e hi).1, hd⟩ }
  onDir I X i :=
    ⟨fun e => (X.1 e ∧ G.part i (N.dst e)) ∨
        ((∃ j, (I j).D e) ∧ G.part i (N.dst e) ∧ pair I (N.src e) (N.dst e)),
      fun _ h => h.elim (fun h => h.2) (fun h => h.2.1)⟩

/-- The routing map of the definition *Routing*: the pairings are read from the groups'
positions. -/
def routing {W : Pred N.U} {ι : Type} (G : Partition W ι) :
    Poly.Hom (Poly.tensor fun i => N.iface (G.part i)) (N.iface W) :=
  route G fun I a b => ∃ j, (I j).P a b

/-! ## Units -/

/-- A box for unit `u`, run in rounds: `step` and `emit` take the envelopes delivered in one
round as a set. `paired s v` says that the log at `s` holds a standing pairing in which `u`
shares with `v`. -/
structure Box (N : Net) (u : N.U) where
  S : Type
  step : S → Pred N.E → S
  emit : S → Pred N.E → Pred N.E
  init : S
  paired : S → N.U → Prop

namespace Box

variable {u : N.U} (B : Box N u)

/-- The state of the box after `n` rounds on the deliveries `xs`. -/
def run (xs : Nat → Pred N.E) : Nat → B.S
  | 0 => B.init
  | n + 1 => B.step (run xs n) (xs n)

/-- The box with its outgoing mailboxes, as a map `S y^S → p_u`. The state is the box's state
and the envelopes it has emitted and not yet delivered. The position shows the standing pairings in
the box's log and the deposits for other units. The update steps the box, drops the envelopes
whose pairing stands, which routing delivers in this round, and deposits what the box emits. -/
def system : Poly.System (B.S × Pred N.E) (N.iface fun v => v = u) where
  onPos x :=
    { P := fun a b => a = u ∧ B.paired x.1 b ∧ b ≠ u
      D := fun e => x.2 e ∧ N.src e = u ∧ N.dst e ≠ u
      P_out := fun _ _ h => ⟨h.1, h.2.2⟩
      D_out := fun _ h => ⟨h.2.1, h.2.2⟩ }
  onDir x X := (B.step x.1 X.1, fun e => (x.2 e ∧ ¬ B.paired x.1 (N.dst e)) ∨ B.emit x.1 X.1 e)

end Box

/-- **A unit with its mailboxes is a dynamical system.** Started with nothing deposited, the
system runs the box: after `n` rounds its state is the box's state, and its deposits are the
envelopes the box emitted in an earlier round and has not delivered since, because the pairing to
their recipient has not stood in any later round. -/
theorem Box.system_run {u : N.U} (B : Box N u) (xs : Nat → N.Dir fun v => v = u) (n : Nat) :
    Poly.System.run B.system (B.init, fun _ => False) (fun m _ => xs m) n =
      (B.run (fun m => (xs m).1) n,
        fun e => ∃ m, m < n ∧ B.emit (B.run (fun m => (xs m).1) m) (xs m).1 e ∧
          ∀ k, m < k → k < n → ¬ B.paired (B.run (fun m => (xs m).1) k) (N.dst e)) := by
  induction n with
  | zero =>
    refine Prod.ext rfl (funext fun e => propext ⟨False.elim, ?_⟩)
    rintro ⟨m, hm, _⟩
    exact absurd hm (Nat.not_lt_zero m)
  | succ n ih =>
    rw [Poly.System.run, ih]
    refine Prod.ext rfl (funext fun e => propext ⟨?_, ?_⟩)
    · rintro (⟨⟨m, hm, h, hk⟩, hn⟩ | h)
      · refine ⟨m, by omega, h, fun k hmk hkn => ?_⟩
        rcases Nat.lt_or_eq_of_le (Nat.le_of_lt_succ hkn) with hkn | hkn
        · exact hk k hmk hkn
        · subst hkn
          exact hn
      · exact ⟨n, by omega, h, fun k hnk hkn => absurd hkn (by omega)⟩
    · rintro ⟨m, hm, h, hk⟩
      rcases Nat.lt_or_eq_of_le (Nat.le_of_lt_succ hm) with hm | hm
      · exact Or.inl ⟨⟨m, hm, h, fun k hmk hkn => hk k hmk (by omega)⟩, hk n hm (by omega)⟩
      · subst hm
        exact Or.inr h

/-! ## Collaborations -/

variable {ι : Type}

/-- One round of the collaboration with changing wiring of the definition *Collaboration with
changing wiring*. Unit `i` receives every envelope deposited for it by a unit `j` whose log holds
the pairing in which `j` shares with it, and stops holding the envelopes it delivers. -/
def round (name : ι → N.U) (B : (i : ι) → Box N (name i))
    (x : (i : ι) → (B i).S × Pred N.E) : (i : ι) → (B i).S × Pred N.E :=
  fun i =>
    let X : Pred N.E := fun e =>
      N.dst e = name i ∧
        ∃ j, (x j).2 e ∧ N.src e = name j ∧ N.dst e ≠ name j ∧ (B j).paired (x j).1 (N.dst e)
    ((B i).step (x i).1 X,
      fun e => ((x i).2 e ∧ ¬ (B i).paired (x i).1 (N.dst e)) ∨ (B i).emit (x i).1 X e)

/-- The units side by side, wired by the routing map of the partition into single units. -/
def collab (name : ι → N.U) (inj : ∀ i j, name i = name j → i = j)
    (B : (i : ι) → Box N (name i)) :
    Poly.System ((i : ι) → (B i).S × Pred N.E) (N.iface fun v => ∃ i, name i = v) :=
  (routing (Partition.singletons name inj)).comp (Poly.System.tensor fun i => (B i).system)

/-- **Changing wiring as a map of polynomials (i).** With nothing arriving from outside, the
composite system steps as one round of the collaboration. -/
theorem collab_step (name : ι → N.U) (inj : ∀ i j, name i = name j → i = j)
    (B : (i : ι) → Box N (name i)) (x : (i : ι) → (B i).S × Pred N.E) :
    (collab name inj B).onDir x (Dir.empty N fun v => ∃ i, name i = v) = round name B x := by
  funext i
  have key : ∀ Y : Pred N.E, Y = (fun e => N.dst e = name i ∧
      ∃ j, (x j).2 e ∧ N.src e = name j ∧ N.dst e ≠ name j ∧ (B j).paired (x j).1 (N.dst e)) →
      ((B i).step (x i).1 Y,
        fun e => ((x i).2 e ∧ ¬ (B i).paired (x i).1 (N.dst e)) ∨ (B i).emit (x i).1 Y e) =
        round name B x i := by
    intro Y hY
    subst hY
    rfl
  refine key _ (funext fun e => propext ⟨?_, ?_⟩)
  · rintro (⟨h, _⟩ | ⟨⟨j, hx, hs, hd⟩, hi, j', hs', hp, _⟩)
    · exact h.elim
    · have hj : j = j' := inj j j' (hs.symm.trans hs')
      subst hj
      exact ⟨hi, j, hx, hs, hd, hp⟩
  · rintro ⟨hi, j, hx, hs, hd, hp⟩
    exact Or.inr ⟨⟨j, hx, hs, hd⟩, hi, j, hs, hp, hd⟩

/-- **Changing wiring as a map of polynomials (ii)**, identity. The routing map of `W` as one group
is the identity on `p_W`. -/
theorem routing_single (W : Pred N.U) :
    (routing (Partition.single W)).comp (Poly.single (N.iface W)) = Poly.Hom.id (N.iface W) := by
  apply Poly.Hom.ext_const
  · intro I
    apply Pos.ext
    · intro a b
      exact ⟨fun ⟨⟨_, h⟩, _⟩ => h, fun h => ⟨⟨(), h⟩, (I.P_out a b h).2⟩⟩
    · intro e
      exact ⟨fun ⟨⟨_, h⟩, _⟩ => h, fun h => ⟨⟨(), h⟩, (I.D_out e h).2⟩⟩
  · intro I X
    apply Dir.ext
    intro e
    constructor
    · rintro (⟨h, _⟩ | ⟨⟨_, hD⟩, hW, _⟩)
      · exact h
      · exact absurd hW (I.D_out e hD).2
    · intro h
      exact Or.inl ⟨h, X.2 e h⟩

/-- **Changing wiring as a map of polynomials (ii)**, nesting. Routing for `W = ⨆ G i` after routing
inside each `G i` is routing for the flattened partition. With `routing_single`, this makes the
interfaces `p_W` and the routing maps a multicategory, and a collaboration a unit of a larger one.
-/
theorem routing_nest {W : Pred N.U} (G : Partition W ι) {κ : ι → Type}
    (H : (i : ι) → Partition (G.part i) (κ i)) :
    (routing G).comp (Poly.tensorHom fun i => routing (H i)) =
      (routing (G.flatten H)).comp (Poly.uncurry fun i j => N.iface ((H i).part j)) := by
  apply Poly.Hom.ext_const
  · intro I
    apply Pos.ext
    · intro a b
      constructor
      · rintro ⟨⟨i, ⟨j, h⟩, _⟩, hw⟩
        exact ⟨⟨⟨i, j⟩, h⟩, hw⟩
      · rintro ⟨⟨⟨i, j⟩, h⟩, hw⟩
        exact ⟨⟨i, ⟨j, h⟩, fun hg => hw (G.sub i b hg)⟩, hw⟩
    · intro e
      constructor
      · rintro ⟨⟨i, ⟨j, h⟩, _⟩, hw⟩
        exact ⟨⟨⟨i, j⟩, h⟩, hw⟩
      · rintro ⟨⟨⟨i, j⟩, h⟩, hw⟩
        exact ⟨⟨i, ⟨j, h⟩, fun hg => hw (G.sub i _ hg)⟩, hw⟩
  · intro I X
    funext i j
    apply Dir.ext
    intro e
    constructor
    · rintro (⟨(⟨hX, _⟩ | ⟨⟨i', ⟨j', hD⟩, _⟩, _, i'', ⟨j'', hP⟩, _⟩), hij⟩ |
          ⟨⟨j', hD⟩, hij, j'', hP⟩)
      · exact Or.inl ⟨hX, hij⟩
      · exact Or.inr ⟨⟨⟨i', j'⟩, hD⟩, hij, ⟨i'', j''⟩, hP⟩
      · exact Or.inr ⟨⟨⟨i, j'⟩, hD⟩, hij, ⟨i, j''⟩, hP⟩
    · rintro (⟨hX, hij⟩ | ⟨⟨⟨i', j'⟩, hD⟩, hij, ⟨i'', j''⟩, hP⟩)
      · exact Or.inl ⟨Or.inl ⟨hX, (H i).sub j _ hij⟩, hij⟩
      · have hs' : G.part i' (N.src e) := (H i').sub j' _ ((I i' j').D_out e hD).1
        have hs'' : G.part i'' (N.src e) := (H i'').sub j'' _ ((I i'' j'').P_out _ _ hP).1
        have h1 : i'' = i' := G.disj i'' i' _ hs'' hs'
        subst h1
        have hGi : G.part i (N.dst e) := (H i).sub j _ hij
        rcases Classical.em (i'' = i) with hii | hii
        · subst hii
          exact Or.inr ⟨⟨j', hD⟩, hij, j'', hP⟩
        · have hnot : ¬ G.part i'' (N.dst e) := fun h => hii (G.disj i'' i _ h hGi)
          exact Or.inl ⟨Or.inr ⟨⟨i'', ⟨j', hD⟩, hnot⟩, hGi, i'', ⟨j'', hP⟩, hnot⟩, hij⟩

end Net

end Cosys
