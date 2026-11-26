import CosysCore
import CosysCalco
import CosysSocial

/-!
Run with `lake env lean Check.lean` after `lake build`. Each line prints the axioms a result
depends on. Every result should list only `propext`, `Quot.sound` and `Classical.choice`, or a
subset of them. `sorryAx` in any line means an unproved step.
-/

-- Polynomials, routing, registries (CosysCore)
#print axioms Cosys.Net.Box.system_run
#print axioms Cosys.Net.collab_step
#print axioms Cosys.Net.routing_single
#print axioms Cosys.Net.routing_nest
#print axioms Cosys.Net.identitor
#print axioms Cosys.Net.compositor
#print axioms Cosys.Net.compositor_unit_left
#print axioms Cosys.Net.compositor_unit_right
#print axioms Cosys.Net.compositor_assoc
-- Gluing and trust (CosysCore)
#print axioms Cosys.Gluing.glue_restrict
#print axioms Cosys.Gluing.glue_unique
#print axioms Cosys.Gluing.glue_view
#print axioms Cosys.Gluing.sheaf_condition
#print axioms Cosys.Trust.reindex_comp
#print axioms Cosys.Trust.reindex_mono
#print axioms Cosys.Trust.Tot.Hom.comp_assoc
#print axioms Cosys.Trust.lift_cartesian
#print axioms Cosys.Trust.hom_unique
#print axioms Cosys.Trust.lift_comp
#print axioms Cosys.Trust.ranking_local
-- Congruence and order independence (CosysCalco)
#print axioms Cosys.Calco.congruence
#print axioms Cosys.Calco.congruence_trace
#print axioms Cosys.Calco.LogNet.recv_fold
#print axioms Cosys.Calco.LogNet.fold_order
#print axioms Cosys.Calco.LogNet.recv_dup
#print axioms Cosys.Calco.finitary_box
#print axioms Cosys.Calco.finitary_eq
#print axioms Cosys.Calco.finitary_continuous
#print axioms Cosys.Calco.order_finite
#print axioms Cosys.Calco.order_finite_agree
#print axioms Cosys.Calco.order_unbounded
#print axioms Cosys.Calco.order_unbounded_agree
#print axioms Cosys.Calco.order_chain
#print axioms Cosys.Calco.order_chain_finitary
#print axioms Cosys.Calco.no_global_quiescence
#print axioms Cosys.Calco.pairing_forms
#print axioms Cosys.Calco.nonmono
#print axioms Cosys.Calco.growing_finite
#print axioms Cosys.Calco.growing_unbounded
#print axioms Cosys.Calco.growing_chain
#print axioms Cosys.Calco.rounds_finite
#print axioms Cosys.Calco.rounds_unbounded
#print axioms Cosys.Calco.rounds_chain
-- Claims and grades (CosysCalco)
#print axioms Cosys.Calco.claimDecidable
#print axioms Cosys.Calco.ClaimExample.claim_decide_example
#print axioms Cosys.Calco.claim_empty_of_unsigned
#print axioms Cosys.Calco.claim_mono
#print axioms Cosys.Calco.signers_accountable
#print axioms Cosys.Calco.agents_cannot_inhabit
#print axioms Cosys.Calco.accepts_claim
#print axioms Cosys.Calco.placement_routing_only
#print axioms Cosys.Calco.grade_mono
#print axioms Cosys.Calco.grade_finite
#print axioms Cosys.Calco.finset_no_top
#print axioms Cosys.Calco.PosBool.add_idem
#print axioms Cosys.Calco.PosBool.mul_idem
#print axioms Cosys.Calco.PosBool.lift_unique
#print axioms Cosys.Calco.PosBool.lift_congr
-- The sort (CosysSocial)
#print axioms Cosys.Social.sort
#print axioms Cosys.Social.positive_iff_witnessed
#print axioms Cosys.Social.positive_finite_witness
#print axioms Cosys.Social.absence_step
#print axioms Cosys.Social.positive_iff_local_sound
#print axioms Cosys.Social.positive_iff_posBool
#print axioms Cosys.Social.rule_iff_posBool
-- CALM for social facts (CosysSocial)
#print axioms Cosys.Social.factOut_box
#print axioms Cosys.Social.positive_settles
#print axioms Cosys.Social.absence_splits
#print axioms Cosys.Social.calm_social
-- Seals (CosysSocial)
#print axioms Cosys.Social.sealed_positive
#print axioms Cosys.Social.latest_asks_absence
#print axioms Cosys.Social.valid_asks_absence
#print axioms Cosys.Social.valid_asOf_positive
#print axioms Cosys.Social.joint_positive
#print axioms Cosys.Social.joint_needs_each
#print axioms Cosys.Social.reopen_needs_each
#print axioms Cosys.Social.checkpoint_positive
#print axioms Cosys.Social.checkpoint_not_institutional
#print axioms Cosys.Social.office_seal_asks_absence
#print axioms Cosys.Social.office_seal_asOf_positive
-- Authority rules, quorums and facades (CosysSocial)
#print axioms Cosys.Social.claimBy_conj
#print axioms Cosys.Social.claimBy_mono
#print axioms Cosys.Social.quorum_monotone
#print axioms Cosys.Social.posBool_monotone
#print axioms Cosys.Social.facade_attribution
#print axioms Cosys.Social.facade_positive
#print axioms Cosys.Social.facade_minority
#print axioms Cosys.Social.personal_beyond_quorum
#print axioms Cosys.Social.no_rotation_by_capture
#print axioms Cosys.Social.suspension_splits
-- Frames in layers (CosysSocial)
#print axioms Cosys.Social.extends_facts
#print axioms Cosys.Social.extends_positive
#print axioms Cosys.Social.inForce_positive
#print axioms Cosys.Social.inForce_asks_absence
#print axioms Cosys.Social.Translation.injective
#print axioms Cosys.Social.translate_positive
-- The examples (CosysSocial)
#print axioms Cosys.Social.Examples.carried_asOf_call_positive
#print axioms Cosys.Social.Examples.carried_asOf_call
#print axioms Cosys.Social.Examples.currentDoseTen_asks_absence
#print axioms Cosys.Social.Examples.dose_asOf_handover_positive
#print axioms Cosys.Social.Examples.nurse_checkpoint_positive
#print axioms Cosys.Social.Examples.no_handover_alone
#print axioms Cosys.Social.Examples.credential_valid_asks_absence
#print axioms Cosys.Social.Examples.credential_valid_asOf_list_positive
#print axioms Cosys.Social.Examples.backdate_changes_outcome
#print axioms Cosys.Social.Examples.backdate_reorders
#print axioms Cosys.Social.Examples.epoch_fixes_order
