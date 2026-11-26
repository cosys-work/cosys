import CosysSocial.Grounding

/-!
# Frames in layers

The section *Frames in layers* of *What Absence Costs*.

A frame gives the grounding condition of each fact it recognizes. A customization that adds keeps
every fact the frame already grounds (`extends_facts`), and keeps every condition that asked only for
records asking only for records (`extends_positive`). A rule kept as records, in force once adopted
while no repeal of it is in the log, asks only for records until repeals exist, and asks for an
absence once they do (`inForce_positive`, `inForce_asks_absence`): a change that takes something away
asks for an absence. Layers meet by translation, with a complement that keeps what the target
drops, so the translation is injective (`Translation.injective`), and a fact that asks only for
records in the target vocabulary still does when read through it (`translate_positive`).
-/

namespace Cosys.Social

variable {Φ R : Type}

/-- A *frame*: the grounding condition of each fact it recognizes. -/
abbrev Frame (Φ R : Type) := Φ → Option (Grounding R)

/-- The facts a frame grounds in a log. -/
def Frame.facts (F : Frame Φ R) (L : Set R) : Set Φ := {φ | ∃ G, F φ = some G ∧ G L}

/-- A customization adds facts and keeps every existing condition. -/
def Frame.Extends (F F' : Frame Φ R) : Prop := ∀ φ G, F φ = some G → F' φ = some G

/-- **A customization that adds keeps every existing fact.** -/
theorem extends_facts {F F' : Frame Φ R} (h : F.Extends F') (L : Set R) :
    F.facts L ⊆ F'.facts L := by
  rintro φ ⟨G, hF, hG⟩
  exact ⟨G, h φ G hF, hG⟩

/-- **A customization that adds keeps presence facts as they were**: if every condition the frame
had asks only for records, and every condition it adds does too, every condition of the customized
frame asks only for records. -/
theorem extends_positive {F F' : Frame Φ R} (h : F.Extends F')
    (hF : ∀ φ G, F φ = some G → Positive G)
    (hnew : ∀ φ G, F φ = none → F' φ = some G → Positive G) :
    ∀ φ G, F' φ = some G → Positive G := by
  intro φ G hG
  cases hφ : F φ with
  | none => exact hnew φ G hφ hG
  | some G0 =>
    rw [h φ G0 hφ] at hG
    obtain rfl := Option.some.inj hG
    exact hF φ G0 hφ

/-- A rule kept as records: in force once adopted, while no repeal of it is in the log. -/
def inForce (adopts repeals : R → Φ → Prop) (φ : Φ) : Grounding R :=
  fun L => (∃ a ∈ L, adopts a φ) ∧ ∀ r ∈ L, ¬ repeals r φ

/-- A rule that nothing can repeal asks only for records. -/
theorem inForce_positive {adopts repeals : R → Φ → Prop} {φ : Φ} (h : ∀ r, ¬ repeals r φ) :
    Positive (inForce adopts repeals φ) := by
  rintro L L' hLL' ⟨⟨a, ha, had⟩, -⟩
  exact ⟨⟨a, hLL' ha, had⟩, fun r _ => h r⟩

/-- **A rule kept as records asks for an absence once repeals exist.** -/
theorem inForce_asks_absence {adopts repeals : R → Φ → Prop} {φ : Φ} {a r : R} (ha : adopts a φ)
    (hna : ¬ repeals a φ) (hr : repeals r φ) : AsksAbsence (inForce adopts repeals φ) := by
  refine ⟨{a}, insert r {a}, Set.subset_insert _ _, ⟨⟨a, Set.mem_singleton a, ha⟩, fun x hx => ?_⟩,
    fun h => h.2 r (Set.mem_insert _ _) hr⟩
  rw [Set.mem_singleton_iff.mp hx]
  exact hna

/-- A translation between vocabularies, with a complement that keeps what the target drops: export
a record into the target and the complement, import it back, and it is unchanged. -/
structure Translation (A B C : Type) where
  forth : A → B × C
  back : B × C → A
  roundtrip : ∀ a, back (forth a) = a

/-- A translation with its complement loses no record. -/
theorem Translation.injective {A B C : Type} (T : Translation A B C) :
    Function.Injective T.forth := by
  intro a b h
  calc a = T.back (T.forth a) := (T.roundtrip a).symm
    _ = T.back (T.forth b) := by rw [h]
    _ = b := T.roundtrip b

/-- **Presence facts cross a translation.** A fact that asks only for records in the target
vocabulary still asks only for records when read through the translation. -/
theorem translate_positive {A B C : Type} (T : Translation A B C) {G : Grounding B}
    (hG : Positive G) : Positive fun L : Set A => G ((fun a => (T.forth a).1) '' L) := by
  intro L L' h hL
  exact hG (Set.image_mono h) hL

end Cosys.Social
