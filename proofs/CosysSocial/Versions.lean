import CosysSocial.Calm
import CosysSocial.Layers

/-!
# Parties on different versions

The results for the section on mixed versions in the PaPoC version of *What Absence Costs*.

A party on an older version reads each record through a view: a map from records to the records
it can read, applied record by record. What crosses such a view, and what does not, follows the
sort of grounding conditions.

- A condition that asks only for records still does when read through any record-wise view
  (`view_positive`); `translate_positive` is its case for a translation.
- A view that identifies two records makes the second invisible once the first is present
  (`lossy_view_blind`), so a defeat at the source can be missed by the older reader
  (`lossy_view_misses_defeat`): an absence crosses only a view that loses nothing.
- A translation with a complement that loses nothing in either direction gives a lens satisfying
  GetPut and PutGet (`Translation.toLens`), and lenses compose (`Lens.comp`).
- CALM for parties on different versions (`versioned_settles`): a unit whose box reads its log
  through a view, and emits a fact once a condition that asks only for records holds of what it
  reads, settles the same way under every fair schedule, on the view of its part of the least fixed
  point.
-/

namespace Cosys.Social

open Cosys.Calco

variable {R R' : Type}

/-- **A condition that asks only for records still does when read through a view**, any map from
records to records applied record by record. -/
theorem view_positive {G : Grounding R'} (hG : Positive G) (f : R → R') :
    Positive fun L : Set R => G (f '' L) :=
  fun _ _ h hL => hG (Set.image_mono h) hL

/-- **A lossy view is blind to a second record it identifies with one already present**: once `r`
is in the log, adding `r'` with the same view changes nothing any condition read through the view
can see. -/
theorem lossy_view_blind {f : R → R'} {r r' : R} (hf : f r = f r') {L : Set R} (hr : r ∈ L)
    (H : Grounding R') : H (f '' insert r' L) ↔ H (f '' L) := by
  have : f '' insert r' L = f '' L := by
    rw [Set.image_insert_eq, Set.insert_eq_of_mem]
    exact hf ▸ Set.mem_image_of_mem f hr
  rw [this]

/-- **An absence crosses only a view that loses nothing.** If `r'` defeats `G` at a log holding a
record the view identifies with it, no condition on what the view shows tracks `G`. -/
theorem lossy_view_misses_defeat {G : Grounding R} {f : R → R'} {r r' : R} (hf : f r = f r')
    {L : Set R} (hr : r ∈ L) (hdef : Defeats G L r') :
    ¬ ∃ H : Grounding R', ∀ X, G X ↔ H (f '' X) := by
  rintro ⟨H, hH⟩
  have h₁ : H (f '' L) := (hH L).1 hdef.1
  have h₂ : ¬ H (f '' insert r' L) := fun h => hdef.2 ((hH _).2 h)
  exact h₂ ((lossy_view_blind hf hr H).2 h₁)

/-- A lens from a source `S` to a view `V` (Foster et al. 2007): `get` reads the view, `put`
writes a view back over a source, and the laws GetPut and PutGet hold. -/
structure Lens (S V : Type) where
  get : S → V
  put : V → S → S
  getPut : ∀ s, put (get s) s = s
  putGet : ∀ v s, get (put v s) = v

/-- **Lenses compose**, and the composite keeps both laws. -/
def Lens.comp {S V W : Type} (l₁ : Lens S V) (l₂ : Lens V W) : Lens S W where
  get s := l₂.get (l₁.get s)
  put w s := l₁.put (l₂.put w (l₁.get s)) s
  getPut s := by simp only [l₂.getPut, l₁.getPut]
  putGet w s := by simp only [l₁.putGet, l₂.putGet]

/-- **A translation with a complement gives a lens**: the view is the translated part, and writing
a view back keeps the complement. PutGet needs the translation to lose nothing going back as well
(`onto`): every pair of a target value and a complement is some record's. -/
def Translation.toLens {A B C : Type} (T : Translation A B C)
    (onto : ∀ p, T.forth (T.back p) = p) : Lens A B where
  get a := (T.forth a).1
  put b a := T.back (b, (T.forth a).2)
  getPut a := by simp only [Prod.mk.eta, T.roundtrip]
  putGet b a := by simp only [onto]

/-- The box of a unit on an older version: it emits the fact record `o` once `G` holds of what its
log shows through the view `f`. -/
def viewOut (G : Grounding R') (f : R → R') (o : R) : Set R → Set R :=
  factOut (fun X => G (f '' X)) o

/-- A condition that asks only for records gives a monotone box through any view. -/
theorem viewOut_box {G : Grounding R'} (hG : Positive G) (f : R → R') (o : R) :
    MonotoneBox (viewOut G f o) :=
  factOut_box (view_positive hG f) o

/-- **CALM for parties on different versions.** If unit `u` reads its log through the view `f` and
emits `o` once `G` holds of what it reads, every fair schedule settles on whether `u` emitted `o`,
and the answer is `G` read through the view on `u`'s part of the least fixed point. -/
theorem versioned_settles {ι : Type} (N : LogNet ι R) (hbox : ∀ u, MonotoneBox (N.Out u))
    (h0 : ∀ u, N.Out u (N.L0 u) = ∅) (hP : ∀ w u, Monotone (N.pairs w u))
    (hfin : ∃ E : Set R, E.Finite ∧ ∀ u, N.In u ⊆ E ∧ N.Out u (N.least hbox hP u) ⊆ E)
    {u : ι} {G : Grounding R'} {f : R → R'} {o : R} (hu : N.Out u = viewOut G f o)
    (σ : ℕ → LogNet.Ev ι R) (hσ : N.Fair σ) :
    ∃ n, ∀ m, n ≤ m → (o ∈ (N.run σ m u).2 ↔ G (f '' (N.least hbox hP u \ {o}))) :=
  positive_settles N hbox h0 hP hfin hu σ hσ

end Cosys.Social
