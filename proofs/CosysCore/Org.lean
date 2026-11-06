import CosysCore.Network

/-!
# Registries as a dynamic organization

The proposition *Registries as a dynamic organization* of *Collaboration Is Composition*.

In Shapiro and Spivak's `Org`, a horizontal morphism from `p` to `q` is a `[p, q]`-coalgebra: a
set of states, each putting out a map `p → q` and updating on what flows through it, a position
of `p` together with a direction of `q` at its image. A dynamic multicategory gives such a
coalgebra for each list of objects and a target, a coalgebra map from the one-state identity
coalgebra (the identitor), and a coalgebra map from each composite to the coalgebra of the
flattened list (the compositor), subject to unit and associativity equations (Definitions 3.2
and A.2 of Shapiro and Spivak).

A registry for `W = ⨆ G i` holds the standing pairings between different groups. At a state it
routes between groups along the pairings it holds; pairings to units outside `W` are still read
from the groups' positions. On a flow it moves to the pairings between groups that the groups
show. The registries take the place of the coalgebras for partitions; for any other list the
coalgebra has no states.
-/

namespace Cosys

open Poly

/-- A `[p, q]`-coalgebra. -/
structure Coalg (p q : Poly) where
  S : Type
  out : S → Hom p q
  upd : (s : S) → (Σ I : p.pos, q.dir ((out s).onPos I)) → S

namespace Coalg

variable {p q r : Poly}

/-- The horizontal identity: one state, putting out the identity. -/
def unit (p : Poly) : Coalg p p where
  S := Unit
  out _ := Hom.id p
  upd _ _ := ()

/-- Horizontal composition: `C`, then `D`. -/
def comp (C : Coalg p q) (D : Coalg q r) : Coalg p r where
  S := C.S × D.S
  out s := (D.out s.2).comp (C.out s.1)
  upd s fl :=
    (C.upd s.1 ⟨fl.1, (D.out s.2).onDir ((C.out s.1).onPos fl.1) fl.2⟩,
      D.upd s.2 ⟨(C.out s.1).onPos fl.1, fl.2⟩)

/-- Coalgebras side by side. -/
def tensor {ι : Type} {p q : ι → Poly} (C : (i : ι) → Coalg (p i) (q i)) :
    Coalg (Poly.tensor p) (Poly.tensor q) where
  S := (i : ι) → (C i).S
  out s := tensorHom fun i => (C i).out (s i)
  upd s fl i := (C i).upd (s i) ⟨fl.1 i, fl.2 i⟩

/-- A coalgebra read along a map into its domain: the vertical side of a square in `Org`. -/
def restrict {p' : Poly} (f : Hom p' p) (C : Coalg p q) : Coalg p' q where
  S := C.S
  out s := (C.out s).comp f
  upd s fl := C.upd s ⟨f.onPos fl.1, fl.2⟩

/-- A direction at the image of `φ`, moved to the image of `ψ` along `φ = ψ`. -/
def transport {φ ψ : Hom p q} (h : φ = ψ) {I : p.pos} (d : q.dir (φ.onPos I)) :
    q.dir (ψ.onPos I) :=
  h ▸ d

/-- A map of coalgebras: a function on states that keeps what each state puts out and commutes
with updates. -/
structure Map (C D : Coalg p q) where
  map : C.S → D.S
  out_map : ∀ s, D.out (map s) = C.out s
  upd_map : ∀ s I (d : q.dir ((C.out s).onPos I)),
    map (C.upd s ⟨I, d⟩) = D.upd (map s) ⟨I, transport (out_map s).symm d⟩

end Coalg

namespace Net

variable {N : Net} {W : Pred N.U} {ι : Type}

/-- `a` and `b` lie in different groups. -/
def Cross (G : Partition W ι) (a b : N.U) : Prop :=
  ∃ i j, G.part i a ∧ G.part j b ∧ i ≠ j

theorem Cross.mem {G : Partition W ι} {a b : N.U} (h : Cross G a b) : W a ∧ W b :=
  match h with
  | ⟨i, j, ha, hb, _⟩ => ⟨G.sub i a ha, G.sub j b hb⟩

/-- A pairing between groups does not stay inside the group of its first end. -/
theorem Cross.not_same {G : Partition W ι} {a b : N.U} (h : Cross G a b) {i : ι}
    (ha : G.part i a) : ¬ G.part i b := by
  intro hb
  obtain ⟨i', j', ha', hb', hne⟩ := h
  exact hne ((G.disj i' i a ha' ha).trans (G.disj i j' b hb hb'))

/-- A pairing between groups is still one after each group is split. -/
theorem Cross.flatten_outer (G : Partition W ι) {κ : ι → Type}
    (H : (i : ι) → Partition (G.part i) (κ i)) {a b : N.U} (h : Cross G a b) :
    Cross (G.flatten H) a b := by
  obtain ⟨i, j, ha, hb, hne⟩ := h
  obtain ⟨c, hc⟩ := (H i).cover a ha
  obtain ⟨d, hd⟩ := (H j).cover b hb
  exact ⟨⟨i, c⟩, ⟨j, d⟩, hc, hd, fun h => hne (congrArg Sigma.fst h)⟩

/-- A pairing between parts of one group is one between parts of the flattened partition. -/
theorem Cross.flatten_inner (G : Partition W ι) {κ : ι → Type}
    (H : (i : ι) → Partition (G.part i) (κ i)) (i : ι) {a b : N.U} (h : Cross (H i) a b) :
    Cross (G.flatten H) a b := by
  obtain ⟨c, d, ha, hb, hne⟩ := h
  refine ⟨⟨i, c⟩, ⟨i, d⟩, ha, hb, fun h => hne ?_⟩
  injection h

/-- A pairing between parts of the flattened partition joins two groups, or two parts of one. -/
theorem Cross.flatten_cases (G : Partition W ι) {κ : ι → Type}
    (H : (i : ι) → Partition (G.part i) (κ i)) {a b : N.U} (h : Cross (G.flatten H) a b) :
    Cross G a b ∨ ∃ i, Cross (H i) a b := by
  obtain ⟨⟨i, c⟩, ⟨j, d⟩, ha, hb, hne⟩ := h
  rcases Classical.em (i = j) with hij | hij
  · subst hij
    exact Or.inr ⟨i, c, d, ha, hb, fun h => hne (h ▸ rfl)⟩
  · exact Or.inl ⟨i, j, (H i).sub c a ha, (H j).sub d b hb, hij⟩

/-- A state of the registry: pairings between different groups. -/
def RegState (G : Partition W ι) : Type :=
  {Q : N.U → N.U → Prop // ∀ a b, Q a b → Cross G a b}

/-- The registry holding no pairings. -/
def RegState.empty (G : Partition W ι) : RegState G := ⟨fun _ _ => False, fun _ _ h => h.elim⟩

/-- The pairing registry of the definition *Pairing registry*, for `W = ⨆ G i`. -/
def registry (G : Partition W ι) :
    Coalg (Poly.tensor fun i => N.iface (G.part i)) (N.iface W) where
  S := RegState G
  out Q := route G fun _ => Q.1
  upd _ fl := ⟨fun a b => Cross G a b ∧ ∃ i, (fl.1 i).P a b, fun _ _ h => h.1⟩

/-! ## The identitor -/

/-- At the empty state, the registry of `W` as one group puts out the identity. -/
theorem registry_single_out (W : Pred N.U) :
    ((registry (Partition.single W)).out (RegState.empty _)).comp (Poly.single (N.iface W)) =
      Hom.id (N.iface W) := by
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
    · rintro (⟨h, _⟩ | ⟨_, _, h⟩)
      · exact h
      · exact h.elim
    · intro h
      exact Or.inl ⟨h, X.2 e h⟩

/-- The registry of `W` as one group stays empty. -/
theorem registry_single_upd (W : Pred N.U) (s : RegState (Partition.single W))
    (fl : Σ _ : (Poly.tensor fun _ : Unit => N.iface W).pos, N.Dir W) :
    (registry (Partition.single W)).upd s fl = RegState.empty _ := by
  apply Subtype.ext
  funext a b
  apply propext
  constructor
  · rintro ⟨⟨i, j, _, _, hne⟩, _⟩
    exact hne rfl
  · exact False.elim

/-- **Registries form a dynamic multicategory**, the identitor: the identity coalgebra maps to the
registry of one group. -/
def identitor (W : Pred N.U) :
    Coalg.Map (Coalg.unit (N.iface W))
      ((registry (Partition.single W)).restrict (Poly.single (N.iface W))) where
  map _ := RegState.empty _
  out_map _ := registry_single_out W
  upd_map _ _ _ := (registry_single_upd W _ _).symm

/-! ## The compositor -/

section compositor

variable (G : Partition W ι) {κ : ι → Type} (H : (i : ι) → Partition (G.part i) (κ i))

/-- Registries inside each group, then the registry between groups. -/
abbrev nested : Coalg (Poly.tensor fun i => Poly.tensor fun j => N.iface ((H i).part j))
    (N.iface W) :=
  Coalg.comp (Coalg.tensor fun i => registry (H i)) (registry G)

/-- The registry of the flattened partition, read along the flattening of the tensor. -/
abbrev flat : Coalg (Poly.tensor fun i => Poly.tensor fun j => N.iface ((H i).part j))
    (N.iface W) :=
  (registry (G.flatten H)).restrict (Poly.uncurry fun i j => N.iface ((H i).part j))

/-- The compositor on states: the union of the pairings the registries hold. -/
def compositorMap (s : (nested G H).S) : (flat G H).S :=
  ⟨fun a b => Cross (G.flatten H) a b ∧ (s.2.1 a b ∨ ∃ i, (s.1 i).1 a b), fun _ _ h => h.1⟩

/-- Nested registries put out the same routing as the flattened one at the union of their
states. -/
theorem compositor_out (s : (nested G H).S) :
    (flat G H).out (compositorMap G H s) = (nested G H).out s := by
  apply Poly.Hom.ext_const
  · intro I
    exact (congrFun (congrArg Poly.Hom.onPos (routing_nest G H)) I).symm
  · intro I X
    funext i j
    apply Dir.ext
    intro e
    constructor
    · rintro (⟨hX, hij⟩ | ⟨⟨⟨i', j'⟩, hD⟩, hij, _, (hQ | ⟨i'', hQ⟩)⟩)
      · exact Or.inl ⟨Or.inl ⟨hX, (H i).sub j _ hij⟩, hij⟩
      · have hs : G.part i' (N.src e) := (H i').sub j' _ ((I i' j').D_out e hD).1
        have hnot := (s.2.2 _ _ hQ).not_same hs
        exact Or.inl ⟨Or.inr ⟨⟨i', ⟨j', hD⟩, hnot⟩, (H i).sub j _ hij, hQ⟩, hij⟩
      · have hc := (s.1 i'').2 _ _ hQ
        have h1 : i'' = i := G.disj i'' i _ hc.mem.2 ((H i).sub j _ hij)
        subst h1
        have hs : G.part i' (N.src e) := (H i').sub j' _ ((I i' j').D_out e hD).1
        have h2 : i' = i'' := G.disj i' i'' _ hs hc.mem.1
        subst h2
        exact Or.inr ⟨⟨j', hD⟩, hij, hQ⟩
    · rintro (⟨(⟨hX, _⟩ | ⟨⟨i', ⟨j', hD⟩, _⟩, _, hQ⟩), hij⟩ | ⟨⟨j', hD⟩, hij, hQ⟩)
      · exact Or.inl ⟨hX, hij⟩
      · exact Or.inr ⟨⟨⟨i', j'⟩, hD⟩, hij, (s.2.2 _ _ hQ).flatten_outer G H, Or.inl hQ⟩
      · exact Or.inr ⟨⟨⟨i, j'⟩, hD⟩, hij, ((s.1 i).2 _ _ hQ).flatten_inner G H i, Or.inr ⟨i, hQ⟩⟩

/-- The union of the states commutes with updates. -/
theorem compositor_upd (s : (nested G H).S)
    (I : (Poly.tensor fun i => Poly.tensor fun j => N.iface ((H i).part j)).pos)
    (d : N.Dir W) :
    compositorMap G H ((nested G H).upd s ⟨I, d⟩) =
      (flat G H).upd (compositorMap G H s) ⟨I, d⟩ := by
  apply Subtype.ext
  funext a b
  apply propext
  constructor
  · rintro ⟨hc, (⟨_, i, ⟨j, hP⟩, _⟩ | ⟨i, _, j, hP⟩)⟩
    · exact ⟨hc, ⟨i, j⟩, hP⟩
    · exact ⟨hc, ⟨i, j⟩, hP⟩
  · rintro ⟨hc, ⟨i, j⟩, hP⟩
    have ha : G.part i a := (H i).sub j a ((I i j).P_out a b hP).1
    rcases hc.flatten_cases G H with hG | ⟨i', hH⟩
    · exact ⟨hc, Or.inl ⟨hG, i, ⟨j, hP⟩, hG.not_same ha⟩⟩
    · have h1 : i' = i := G.disj i' i a hH.mem.1 ha
      subst h1
      exact ⟨hc, Or.inr ⟨i', hH, j, hP⟩⟩

/-- **Registries form a dynamic multicategory**, the compositor: a coalgebra map from the nested
registries to the registry of the flattened partition. -/
def compositor : Coalg.Map (nested G H) (flat G H) where
  map := compositorMap G H
  out_map := compositor_out G H
  upd_map s I d := compositor_upd G H s I d

end compositor

/-! ## The equations

The two sides of each equation live over differently bracketed index types, so the equations
compare the sets of pairings the states hold. -/

/-- **Registries form a dynamic multicategory**, left unit: the empty registry of one group,
composed with a registry `Q`, gives `Q`. -/
theorem compositor_unit_left (G : Partition W ι) (Q : RegState G) :
    (compositorMap (Partition.single W) (fun _ => G) (fun _ => Q, RegState.empty _)).1 = Q.1 := by
  funext a b
  apply propext
  constructor
  · rintro ⟨_, (h | ⟨_, h⟩)⟩
    · exact h.elim
    · exact h
  · intro h
    exact ⟨(Q.2 a b h).flatten_inner (Partition.single W) (fun _ => G) (), Or.inr ⟨(), h⟩⟩

/-- **Registries form a dynamic multicategory**, right unit: a registry `Q`, composed with the empty
registries of its groups taken whole, gives `Q`. -/
theorem compositor_unit_right (G : Partition W ι) (Q : RegState G) :
    (compositorMap G (fun i => Partition.single (G.part i)) (fun _ => RegState.empty _, Q)).1 =
      Q.1 := by
  funext a b
  apply propext
  constructor
  · rintro ⟨_, (h | ⟨_, h⟩)⟩
    · exact h
    · exact h.elim
  · intro h
    exact ⟨(Q.2 a b h).flatten_outer G _, Or.inl h⟩

/-- **Registries form a dynamic multicategory**, associativity: composing three levels of registries
in either order gives the same pairings. -/
theorem compositor_assoc (G : Partition W ι) {κ : ι → Type}
    (H : (i : ι) → Partition (G.part i) (κ i)) {μ : (i : ι) → κ i → Type}
    (K : (i : ι) → (j : κ i) → Partition ((H i).part j) (μ i j))
    (sG : RegState G) (sH : (i : ι) → RegState (H i))
    (sK : (i : ι) → (j : κ i) → RegState (K i j)) :
    (compositorMap (G.flatten H) (fun k => K k.1 k.2)
        (fun k => sK k.1 k.2, compositorMap G H (sH, sG))).1 =
      (compositorMap G (fun i => (H i).flatten (K i))
        (fun i => compositorMap (H i) (K i) (sK i, sH i), sG)).1 := by
  funext a b
  apply propext
  constructor
  · rintro ⟨_, (⟨_, (h | ⟨i, h⟩)⟩ | ⟨⟨i, j⟩, h⟩)⟩
    · exact ⟨(sG.2 a b h).flatten_outer G _, Or.inl h⟩
    · have hc := ((sH i).2 a b h).flatten_outer (H i) (K i)
      exact ⟨hc.flatten_inner G _ i, Or.inr ⟨i, hc, Or.inl h⟩⟩
    · have hc := ((sK i j).2 a b h).flatten_inner (H i) (K i) j
      exact ⟨hc.flatten_inner G _ i, Or.inr ⟨i, hc, Or.inr ⟨j, h⟩⟩⟩
  · rintro ⟨_, (h | ⟨i, _, (h | ⟨j, h⟩)⟩)⟩
    · have hc := (sG.2 a b h).flatten_outer G H
      exact ⟨hc.flatten_outer (G.flatten H) _, Or.inl ⟨hc, Or.inl h⟩⟩
    · have hc := ((sH i).2 a b h).flatten_inner G H i
      exact ⟨hc.flatten_outer (G.flatten H) _, Or.inl ⟨hc, Or.inr ⟨i, h⟩⟩⟩
    · exact ⟨((sK i j).2 a b h).flatten_inner (G.flatten H) (fun k => K k.1 k.2) ⟨i, j⟩,
        Or.inr ⟨⟨i, j⟩, h⟩⟩

end Net

end Cosys
