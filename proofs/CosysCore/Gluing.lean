import CosysCore.Basic

/-!
# Gluing of record sets

The proposition *Gluing of record sets* of *Collaboration Without Orchestration*. Units `u i` hold
logs `L i`. `A i` is the set of records whose audience includes `u i`, so each `L i` lies inside
`A i`. If the logs agree on every overlap of audiences, their union is the one set of records
inside the union of the audiences that restricts to every log, and a view computed from a log is
the view computed from the glued set restricted to that audience.

`sheaf_condition` puts the two directions together: the families that agree on overlaps are
exactly the restrictions of one record set to the cover `A`.
-/

namespace Cosys.Gluing

variable {ι R : Type}

/-- The part of `X` inside the audience `A`. -/
def restrict (A X : Pred R) : Pred R := fun r => X r ∧ A r

/-- The logs agree on overlaps: `L i ∩ A j = L j ∩ A i`. -/
def Agree (A L : ι → Pred R) : Prop :=
  ∀ i j r, (L i r ∧ A j r) ↔ (L j r ∧ A i r)

/-- The glued record set, the union of the logs. -/
def glue (L : ι → Pred R) : Pred R := fun r => ∃ i, L i r

/-- The cover given by audiences: `A i` holds the records whose audience includes `u i`. -/
def audienceCover {U : Type} (aud : R → U → Prop) (u : ι → U) : ι → Pred R :=
  fun i r => aud r (u i)

/-- The glued set lies inside the union of the audiences. -/
theorem glue_covered (A L : ι → Pred R) (hsub : ∀ i r, L i r → A i r) :
    ∀ r, glue L r → ∃ i, A i r :=
  fun r ⟨i, h⟩ => ⟨i, hsub i r h⟩

/-- The glued set restricts to every log. -/
theorem glue_restrict (A L : ι → Pred R) (hsub : ∀ i r, L i r → A i r) (hagree : Agree A L)
    (i : ι) : restrict (A i) (glue L) = L i := by
  funext r
  apply propext
  constructor
  · rintro ⟨⟨j, hj⟩, hi⟩
    exact ((hagree j i r).mp ⟨hj, hi⟩).1
  · intro h
    exact ⟨⟨i, h⟩, hsub i r h⟩

/-- A record set inside the union of the audiences that restricts to every log is the glued
set. -/
theorem glue_unique (A L : ι → Pred R) (X : Pred R) (hX : ∀ r, X r → ∃ i, A i r)
    (hres : ∀ i, restrict (A i) X = L i) : X = glue L := by
  funext r
  apply propext
  constructor
  · intro h
    obtain ⟨i, hi⟩ := hX r h
    exact ⟨i, hres i ▸ ⟨h, hi⟩⟩
  · rintro ⟨i, h⟩
    rw [← hres i] at h
    exact h.1

/-- A view that is a function of a log agrees with the view of the glued set restricted to that
audience. -/
theorem glue_view {V : Type} (view : Pred R → V) (A L : ι → Pred R)
    (hsub : ∀ i r, L i r → A i r) (hagree : Agree A L) (i : ι) :
    view (restrict (A i) (glue L)) = view (L i) := by
  rw [glue_restrict A L hsub hagree i]

/-- Restrictions of one record set always agree on overlaps. -/
theorem restrict_agree (A : ι → Pred R) (X : Pred R) : Agree A (fun i => restrict (A i) X) :=
  fun _ _ _ => ⟨fun ⟨⟨hx, hi⟩, hj⟩ => ⟨⟨hx, hj⟩, hi⟩, fun ⟨⟨hx, hj⟩, hi⟩ => ⟨⟨hx, hi⟩, hj⟩⟩

/-- The sheaf condition for record sets on the cover `A`: a family of logs, each inside its
audience, agrees on overlaps exactly when it is the family of restrictions of one record set
inside the union of the audiences. -/
theorem sheaf_condition (A L : ι → Pred R) :
    ((∀ i r, L i r → A i r) ∧ Agree A L) ↔
      ∃ X : Pred R, (∀ r, X r → ∃ i, A i r) ∧ ∀ i, restrict (A i) X = L i := by
  constructor
  · rintro ⟨hsub, hagree⟩
    exact ⟨glue L, glue_covered A L hsub, glue_restrict A L hsub hagree⟩
  · rintro ⟨X, _, hres⟩
    have hL : L = fun i => restrict (A i) X := funext fun i => (hres i).symm
    subst hL
    exact ⟨fun _ _ h => h.2, restrict_agree A X⟩

end Cosys.Gluing
