import CosysCore
import CosysCalco

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
#print axioms Cosys.Trust.ranking_local
-- Congruence and order independence (CosysCalco)
#print axioms Cosys.Calco.congruence
#print axioms Cosys.Calco.congruence_trace
#print axioms Cosys.Calco.order_finite
#print axioms Cosys.Calco.order_finite_agree
#print axioms Cosys.Calco.order_unbounded
#print axioms Cosys.Calco.order_unbounded_agree
#print axioms Cosys.Calco.order_chain
#print axioms Cosys.Calco.no_global_quiescence
#print axioms Cosys.Calco.nonmono
#print axioms Cosys.Calco.rounds_finite
#print axioms Cosys.Calco.rounds_unbounded
#print axioms Cosys.Calco.rounds_chain
-- Claims and grades (CosysCalco)
#print axioms Cosys.Calco.claimDecidable
#print axioms Cosys.Calco.claim_empty_of_unsigned
#print axioms Cosys.Calco.claim_mono
#print axioms Cosys.Calco.signers_accountable
#print axioms Cosys.Calco.agents_cannot_inhabit
#print axioms Cosys.Calco.placement_routing_only
#print axioms Cosys.Calco.grade_mono
#print axioms Cosys.Calco.grade_finite
#print axioms Cosys.Calco.finset_no_top
#print axioms Cosys.Calco.PosBool.add_idem
#print axioms Cosys.Calco.PosBool.mul_idem
#print axioms Cosys.Calco.PosBool.lift_unique
#print axioms Cosys.Calco.PosBool.lift_congr
