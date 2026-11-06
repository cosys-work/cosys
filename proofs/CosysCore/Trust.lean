import CosysCore.Basic

/-!
# Trust as a fibration over observers

The proposition of the section *Trust as a fibration over observers* of *Collaboration Is
Composition*.

Observers form the free category on the sharing graph, with an arrow `v ⟶ u` for each standing
pairing in which `u` shares with `v`. The fiber over a unit `u` is the poset of record sets inside
`u`'s audience, ordered by inclusion. Reindexing along `v ⟶ u` keeps the records whose audience
includes `v`, and along a path it does so once for each unit the path passes through.

Reindexing is strictly functorial, contravariantly, so the Grothendieck construction is a split
fibration: every reindexed set comes with a cartesian lift, the factorisation through it is unique,
and the chosen lifts compose strictly.
-/

namespace Cosys.Trust

variable {U R : Type}

/-- Paths in the free category on the sharing graph. `shares u v` gives an arrow `v ⟶ u`, and
`cons p h` extends a path `w ⟶ v` by that arrow to `w ⟶ u`. -/
inductive Path (shares : U → U → Prop) : U → U → Type
  | nil (u : U) : Path shares u u
  | cons {w v u : U} (p : Path shares w v) (h : shares u v) : Path shares w u

variable {shares : U → U → Prop}

/-- Composition of paths: `g` first, then `f`. -/
def Path.comp {w v u : U} (g : Path shares w v) : Path shares v u → Path shares w u
  | .nil _ => g
  | .cons f h => .cons (g.comp f) h

theorem Path.comp_nil {v u : U} (g : Path shares v u) : g.comp (.nil u) = g := rfl

theorem Path.nil_comp {v u : U} (f : Path shares v u) : (Path.nil v).comp f = f := by
  induction f with
  | nil => rfl
  | cons f h ih => exact congrArg (Path.cons · h) ih

theorem Path.comp_assoc {x w v u : U} (k : Path shares x w) (g : Path shares w v)
    (f : Path shares v u) : (k.comp g).comp f = k.comp (g.comp f) := by
  induction f with
  | nil => rfl
  | cons f h ih => exact congrArg (Path.cons · h) ih

/-- The fiber over `u`: record sets inside `u`'s audience. -/
def Fiber (aud : R → U → Prop) (u : U) : Type := {X : Pred R // ∀ r, X r → aud r u}

/-- The order on a fiber. -/
def Fiber.le {aud : R → U → Prop} {u : U} (X Y : Fiber aud u) : Prop := ∀ r, X.1 r → Y.1 r

/-- The part of `X` whose audience includes `v`: reindexing along one arrow `v ⟶ u`. -/
def Fiber.restrict {aud : R → U → Prop} {u : U} (v : U) (X : Fiber aud u) : Fiber aud v :=
  ⟨fun r => X.1 r ∧ aud r v, fun _ h => h.2⟩

/-- Reindexing along a path `w ⟶ u`, from the fiber over `u` to the fiber over `w`. -/
def reindex (aud : R → U → Prop) {w u : U} : Path shares w u → Fiber aud u → Fiber aud w
  | .nil _ => fun X => X
  | .cons (v := v) p _ => fun X => reindex aud p (X.restrict v)

variable (aud : R → U → Prop)

/-- Reindexing along the empty path is the identity. -/
theorem reindex_nil (u : U) (X : Fiber aud u) : reindex aud (Path.nil (shares := shares) u) X = X :=
  rfl

/-- Reindexing along a composite is the composite of reindexings, in the opposite order. -/
theorem reindex_comp {w v u : U} (g : Path shares w v) (f : Path shares v u) (X : Fiber aud u) :
    reindex aud (g.comp f) X = reindex aud g (reindex aud f X) := by
  induction f with
  | nil => rfl
  | cons f _ ih => exact ih _

/-- Reindexing is monotone, so it is a functor between fibers. -/
theorem reindex_mono {w u : U} (f : Path shares w u) (X Y : Fiber aud u) (h : X.le Y) :
    (reindex aud f X).le (reindex aud f Y) := by
  induction f with
  | nil => exact h
  | cons f _ ih => exact ih _ _ fun r hr => ⟨h r hr.1, hr.2⟩

/-! ## The Grothendieck construction -/

/-- An object of `∫ T`: an observer and a record set in its fiber. -/
structure Tot (aud : R → U → Prop) where
  obs : U
  set : Fiber aud obs

/-- A morphism of `∫ T` from `a` to `b`: a path `a.obs ⟶ b.obs` along which `a.set` lies inside
the reindexed `b.set`. -/
def Tot.Hom (shares : U → U → Prop) (a b : Tot aud) : Type :=
  {f : Path shares a.obs b.obs // (a.set).le (reindex aud f b.set)}

/-- The identity of `∫ T`, over the empty path. -/
def Tot.Hom.id (a : Tot aud) : Tot.Hom aud shares a a := ⟨.nil a.obs, fun _ h => h⟩

/-- Composition in `∫ T`, over the composite path. -/
def Tot.Hom.comp {a b c : Tot aud} (f : Tot.Hom aud shares a b) (g : Tot.Hom aud shares b c) :
    Tot.Hom aud shares a c :=
  ⟨f.1.comp g.1, by
    rw [reindex_comp]
    exact fun r hr => reindex_mono aud f.1 _ _ g.2 r (f.2 r hr)⟩

theorem Tot.Hom.id_comp {a b : Tot aud} (f : Tot.Hom aud shares a b) :
    (Tot.Hom.id aud a).comp aud f = f :=
  Subtype.ext (Path.nil_comp f.1)

theorem Tot.Hom.comp_id {a b : Tot aud} (f : Tot.Hom aud shares a b) :
    f.comp aud (Tot.Hom.id aud b) = f :=
  Subtype.ext (Path.comp_nil f.1)

theorem Tot.Hom.comp_assoc {a b c d : Tot aud} (f : Tot.Hom aud shares a b)
    (g : Tot.Hom aud shares b c) (h : Tot.Hom aud shares c d) :
    (f.comp aud g).comp aud h = f.comp aud (g.comp aud h) :=
  Subtype.ext (Path.comp_assoc f.1 g.1 h.1)

/-- The lift of `f : v ⟶ u` at `X` over `u`: the morphism from the reindexed set to `X`. -/
def lift {v u : U} (f : Path shares v u) (X : Fiber aud u) :
    Tot.Hom aud shares ⟨v, reindex aud f X⟩ ⟨u, X⟩ :=
  ⟨f, fun _ h => h⟩

/-- **Trust is a split fibration**, the lift is cartesian: every morphism into `⟨u, X⟩` whose path
is `g` followed by `f` factors through the lift of `f`, by a morphism over `g`. -/
theorem lift_cartesian {w v u : U} (f : Path shares v u) (X : Fiber aud u) {c : Fiber aud w}
    (g : Path shares w v) (h : Tot.Hom aud shares ⟨w, c⟩ ⟨u, X⟩) (hg : h.1 = g.comp f) :
    ∃ k : Tot.Hom aud shares ⟨w, c⟩ ⟨v, reindex aud f X⟩,
      k.1 = g ∧ k.comp aud (lift aud f X) = h := by
  have hle := h.2
  rw [hg, reindex_comp] at hle
  exact ⟨⟨g, hle⟩, rfl, Subtype.ext hg.symm⟩

/-- **Trust is a split fibration**, the factorisation is unique: two morphisms over the same path
are equal, since each fiber is a poset. -/
theorem hom_unique {a b : Tot aud} (k k' : Tot.Hom aud shares a b) (h : k.1 = k'.1) : k = k' :=
  Subtype.ext h

/-- **Trust is a split fibration**, the chosen lifts compose strictly: the lift of `g` at the
reindexed set, followed by the lift of `f`, lies over the composite path, and its domain is the set
reindexed along the composite. -/
theorem lift_comp {w v u : U} (g : Path shares w v) (f : Path shares v u) (X : Fiber aud u) :
    ((lift aud g (reindex aud f X)).comp aud (lift aud f X)).1 = (lift aud (g.comp f) X).1 ∧
      reindex aud (g.comp f) X = reindex aud g (reindex aud f X) :=
  ⟨rfl, reindex_comp aud g f X⟩

/-- The design rule on rankings, recorded: a ranking that an observer `m` computes reads only its
own fiber, so it agrees for any two states of the network that agree on that fiber. This holds by
its typing. That no record publishes a ranking is a rule of the design, not a theorem. -/
theorem ranking_local {α : Type} (rank : (m : U) → Fiber aud m → α)
    (L L' : (m : U) → Fiber aud m) (m : U) (h : L m = L' m) :
    rank m (L m) = rank m (L' m) := by
  rw [h]

end Cosys.Trust
