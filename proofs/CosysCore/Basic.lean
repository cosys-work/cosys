/-!
# Polynomials, their maps, and partitions

The part of the category `Poly` of polynomial functors that the statements use. A polynomial has a
type of positions and, at each position, a type of directions. A map of polynomials sends
positions forward and directions back, and the backward part may depend on the position. A
dynamical system with states `S` and interface `p` is a map `S y^S → p`.

Sets are predicates, and nothing here asks a set to be finite: finiteness plays no part in the
algebra.
-/

namespace Cosys

/-- A set of elements of `α`, as a predicate. -/
abbrev Pred (α : Type) : Type := α → Prop

/-- A polynomial functor `Σ (i : pos), y^(dir i)`. -/
structure Poly where
  /-- What a system with this interface can show. -/
  pos : Type
  /-- What it accepts at a given position. -/
  dir : pos → Type

namespace Poly

/-- A map of polynomials: forward on positions, backward on directions. -/
structure Hom (p q : Poly) where
  onPos : p.pos → q.pos
  onDir : (i : p.pos) → q.dir (onPos i) → p.dir i

/-- The identity map. -/
def Hom.id (p : Poly) : Hom p p where
  onPos i := i
  onDir _ d := d

/-- Composition: `g` after `f`. -/
def Hom.comp {p q r : Poly} (g : Hom q r) (f : Hom p q) : Hom p r where
  onPos i := g.onPos (f.onPos i)
  onDir i d := f.onDir i (g.onDir (f.onPos i) d)

theorem Hom.id_comp {p q : Poly} (f : Hom p q) : (Hom.id q).comp f = f := rfl

theorem Hom.comp_id {p q : Poly} (f : Hom p q) : f.comp (Hom.id p) = f := rfl

theorem Hom.comp_assoc {p q r s : Poly} (h : Hom r s) (g : Hom q r) (f : Hom p q) :
    (h.comp g).comp f = h.comp (g.comp f) := rfl

/-- Two maps into a polynomial whose directions do not depend on the position are equal when they
agree on positions and on directions. -/
theorem Hom.ext_const {p : Poly} {Q D : Type} {f g : Hom p ⟨Q, fun _ => D⟩}
    (hpos : ∀ i, f.onPos i = g.onPos i) (hdir : ∀ i d, f.onDir i d = g.onDir i d) : f = g := by
  obtain ⟨fp, fd⟩ := f
  obtain ⟨gp, gd⟩ := g
  have h1 : fp = gp := funext hpos
  subst h1
  have h2 : fd = gd := funext fun i => funext fun d => hdir i d
  subst h2
  rfl

/-- The tensor of a family of polynomials: positions and directions are taken componentwise. -/
@[reducible] def tensor {ι : Type} (p : ι → Poly) : Poly where
  pos := (i : ι) → (p i).pos
  dir I := (i : ι) → (p i).dir (I i)

/-- The tensor of a family of maps. -/
def tensorHom {ι : Type} {p q : ι → Poly} (f : (i : ι) → Hom (p i) (q i)) :
    Hom (tensor p) (tensor q) where
  onPos I i := (f i).onPos (I i)
  onDir I d i := (f i).onDir (I i) (d i)

/-- A polynomial as the tensor of the one-member family it forms. -/
def single (p : Poly) : Hom p (tensor fun _ : Unit => p) where
  onPos I _ := I
  onDir _ d := d ()

/-- Flattening a tensor of tensors into one tensor over pairs of indices. -/
def uncurry {ι : Type} {κ : ι → Type} (p : (i : ι) → κ i → Poly) :
    Hom (tensor fun i => tensor fun j => p i j) (tensor fun k : (Σ i, κ i) => p k.1 k.2) where
  onPos I k := I k.1 k.2
  onDir _ d i j := d ⟨i, j⟩

/-- The monomial `S y^S`. -/
@[reducible] def selfMonomial (S : Type) : Poly where
  pos := S
  dir _ := S

/-- A dynamical system with states `S` and interface `p`, a map `S y^S → p`. Its position at a
state is what it shows, and its update takes a state and a direction at that position. -/
abbrev System (S : Type) (p : Poly) : Type := Hom (selfMonomial S) p

/-- Systems run side by side. -/
def System.tensor {ι : Type} {S : ι → Type} {p : ι → Poly} (φ : (i : ι) → System (S i) (p i)) :
    System ((i : ι) → S i) (Poly.tensor p) :=
  tensorHom φ

/-- Run a system from `s₀` against an environment that, at step `n`, answers whatever position
the system shows. -/
def System.run {S : Type} {p : Poly} (φ : System S p) (s₀ : S)
    (env : Nat → (i : p.pos) → p.dir i) : Nat → S
  | 0 => s₀
  | n + 1 =>
    let s := System.run φ s₀ env n
    φ.onDir s (env n (φ.onPos s))

end Poly

/-- A partition of `W` into parts indexed by `ι`. -/
structure Partition {U : Type} (W : Pred U) (ι : Type) where
  part : ι → Pred U
  sub : ∀ i v, part i v → W v
  disj : ∀ i j v, part i v → part j v → i = j
  cover : ∀ v, W v → ∃ i, part i v

namespace Partition

variable {U : Type}

/-- `W` as one part. -/
def single (W : Pred U) : Partition W Unit where
  part _ := W
  sub _ _ h := h
  disj _ _ _ _ _ := rfl
  cover _ h := ⟨(), h⟩

/-- Each part split again, read as one partition over pairs of indices. -/
def flatten {W : Pred U} {ι : Type} (G : Partition W ι) {κ : ι → Type}
    (H : (i : ι) → Partition (G.part i) (κ i)) : Partition W (Σ i, κ i) where
  part k := (H k.1).part k.2
  sub k v h := G.sub k.1 v ((H k.1).sub k.2 v h)
  disj := by
    intro ⟨i, j⟩ ⟨i', j'⟩ v h h'
    have hi : i = i' := G.disj i i' v ((H i).sub j v h) ((H i').sub j' v h')
    subst hi
    have hj : j = j' := (H i).disj j j' v h h'
    subst hj
    rfl
  cover v hv := by
    obtain ⟨i, hi⟩ := G.cover v hv
    obtain ⟨j, hj⟩ := (H i).cover v hi
    exact ⟨⟨i, j⟩, hj⟩

/-- The named units, one to a part. -/
def singletons {ι : Type} (name : ι → U) (inj : ∀ i j, name i = name j → i = j) :
    Partition (fun v => ∃ i, name i = v) ι where
  part i v := v = name i
  sub i _ h := ⟨i, h.symm⟩
  disj i j _ hi hj := inj i j (hi.symm.trans hj)
  cover _ h := match h with
    | ⟨i, hi⟩ => ⟨i, hi.symm⟩

end Partition

end Cosys
