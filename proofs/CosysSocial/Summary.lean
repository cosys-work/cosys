import CosysSocial.Seal

/-!
# A summary sealed as of a checkpoint

The stretch result for bounded storage in the PaPoC version of *What Absence Costs*: a device with
little room keeps a sealed summary in place of the records a checkpoint covers. A checkpoint is a
seal whose rule asks for its observer's signature alone (`checkpoint_positive`), naming the records
it covers; the summary is the condition the seal states of them.

`summary_answers`: when the seal says a condition that asks only for records held of the records it
names, that condition holds of every log that holds those records, and the seal itself still stands
in it. So a device that dropped the covered records answers a positive question as they would have,
and fetches them again only for a question the summary does not state.
-/

namespace Cosys.Social

open Cosys.Calco

variable {R Role Key K U : Type}
variable (S : Signed R Role Key K U)

/-- **A summary sealed as of a checkpoint answers a positive question as the records it replaces
would.** If a checkpoint in the log `D` a device keeps seals that `G` held of the records it names,
and those records are all in the full log `L ⊇ D`, then `G` holds of `L`, and the checkpoint still
seals `G` in `L`. -/
theorem summary_answers (C : SealKind R Role Key K) {obs : Key} {role : Role}
    (hC : ∀ q L, C.auth q L = {(role, obs)}) (q : C.Param) {G : Grounding R} (hG : Positive G)
    {D L : Set R} (hDL : D ⊆ L) (hcov : ∀ s ∈ Claim S C.toClaimKind q D, C.named s ⊆ L)
    (hs : sealed S C q G D) : G L ∧ sealed S C q G L := by
  obtain ⟨s, hsD, hG'⟩ := hs
  exact ⟨hG (hcov s hsD) hG', checkpoint_positive S C hC q G hDL ⟨s, hsD, hG'⟩⟩

end Cosys.Social
