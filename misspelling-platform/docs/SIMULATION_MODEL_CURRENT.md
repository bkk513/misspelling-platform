# Current Simulation Model

This note describes the simulation system as it is implemented in the current codebase. It is intended for system acceptance, oral defense preparation, and future model upgrades.

## 1. Current Model Boundary

- The current simulation unit is `one canonical word + one selected misspelling set`.
- The model does not simulate each misspelling variant as an independent agent state.
- The simulated competition is `standard spelling` versus `aggregated nonstandard cluster`.
- The error side is constructed by summing the observed time series of all selected misspelling variants.
- Variant-level information is retained only as descriptive evidence through `variant_breakdown`; it is not the state space of the ABM.

In other words, the present system answers this question:

`How does a nonstandard spelling cluster compete with the standard spelling for one word under social reinforcement, correction pressure, and network topology?`

It does not yet answer this stronger question:

`How do multiple misspelling variants compete with one another inside the nonstandard camp?`

## 2. Data Flow

Code path:

- task entry: `backend/app/tasks/__init__.py`
- dataset builder: `backend/app/algos/dataset_builder.py`
- GBNC cache and snapshot pull: `backend/app/services/gbnc_data_service.py`
- simulation core: `backend/app/algos/simulation_adapter.py`
- simulation explanation: `backend/app/services/simulation_explain_service.py`
- task detail display: `frontend/src/pages/TaskDetail.tsx`

Runtime flow:

1. The task receives `word`, `variants`, `start_year`, `end_year`, `corpus`, `smoothing`, `topology`, `n_agents`, `search_rounds`, `repeats`, and other fit parameters.
2. `build_algorithm_dataset(...)` pulls GBNC data through the cache-aware path and persists a task-specific time-series snapshot.
3. `build_simulation_dataset(...)` reads the task snapshot.
4. The canonical spelling series becomes the observed `right` trajectory.
5. All selected misspelling series are smoothed and summed into the observed `error` trajectory.
6. The system computes `total = right + error` and `error_share = error / total`.
7. `_detect_phase_break(...)` finds the phase transition point from the observed error-share series.
8. `NetworkSpellingABM.fit(...)` searches ABM parameters to minimize the weighted mismatch between observed and simulated `right`, `error`, and `error_share`.
9. The task outputs:
   - fit summary
   - best parameters
   - network summary
   - intervention scenarios
   - yearly observed/simulated rows
   - descriptive misspelling breakdown

## 3. Node, Edge, and State Semantics

### 3.1 Node meaning

- A node is a `synthetic exposure or writing unit`.
- In defense language, the safest expression is:
  `Each node represents a potential language user or exposure-writing opportunity in the diffusion network, not a directly reconstructed real social-media account.`

This matters because the current system does not ingest a real follower graph. It builds a synthetic contact network with complex-network topology generators, then calibrates the diffusion process against observed aggregate trajectories.

### 3.2 Edge meaning

- An edge means `potential social exposure or imitation channel`.
- It is not a verified social-media friendship edge or repost edge.
- Its role is to encode local reinforcement, hub amplification, and correction diffusion under different topology assumptions.

### 3.3 State space

The node state space is three-valued:

- `unknown`
- `error_cluster`
- `right`

Transition intuition:

- `unknown -> error_cluster`: spontaneous mistake pressure plus local exposure to error
- `unknown -> right`: local exposure to the standard form
- `error_cluster -> right`: proofreading pressure and norm pressure
- `right -> unknown`: forgetting
- `right -> error_cluster`: relapse under error exposure

This is a stochastic reinforcement model, not a deterministic threshold rule and not a classic SIR clone.

## 4. Why the Current Model Is Still Defensible

The current implementation is defensible if the thesis question is framed as:

`group spelling behavior = group adoption and persistence of nonstandard spelling behavior`

Under that framing, the research object is the competition between `normative` and `non-normative` behavior classes, rather than the competition among every fine-grained error variant.

This is academically acceptable because many language competition and social contagion studies start with reduced state spaces:

- binary competition
- ternary competition
- bilingual or mixed intermediate states
- only later extend to multi-state competition when the finer competition itself becomes the research target

## 5. Why a Multi-Variant Competition Upgrade Is Not Mandatory Right Now

For the current graduation-defense objective, a multi-variant upgrade is not mandatory if you make the scope explicit:

- one task simulates one word
- one word can have multiple observed misspelling variants
- those variants are aggregated into one nonstandard cluster for the ABM
- variant-level rows remain descriptive evidence, not simulated state variables

This version is easier to defend because:

- the state definition is clear
- the parameter search space stays manageable
- the fit target is stable
- the current outputs already support intervention analysis
- it answers the teacher's core question of `what spreads, through what network, and under what mechanism`

## 6. When a Multi-Variant Competition Upgrade Becomes Necessary

A multi-variant upgrade becomes necessary only if you want to claim one of the following:

- the system explains why `variant A` beats `variant B`
- the system predicts substitution among different misspelling forms
- the research focus is no longer `normative vs non-normative`, but `competition inside the nonstandard camp`

That upgrade would require:

- state space from 3 states to `2 + K` states
- variant-specific transition rules
- variant-specific copying and proofreading parameters
- variant-specific seeding
- a new fit objective over the full variant matrix, not only over total error volume and error share

This is a valid next-stage research direction, but it is a different model class with a much larger parameter-identification burden.

## 7. Literature Basis for the Current Design

Primary references that support the current model framing:

1. Granovetter, M. (1978). `Threshold Models of Collective Behavior`. American Journal of Sociology, 83(6), 1420-1443.
   Link: https://doi.org/10.1086/226707
   Relevance: collective adoption can be modeled as socially conditioned state transition rather than simple independent infection.

2. Centola, D., and Macy, M. (2007). `Complex Contagions and the Weakness of Long Ties`. American Journal of Sociology, 113(3), 702-734.
   Link: https://doi.org/10.1086/521848
   Relevance: behaviors that require reinforcement are better modeled as complex contagions than as one-shot simple contagions.

3. Centola, D. (2010). `The Spread of Behavior in an Online Social Network Experiment`. Science, 329(5996), 1194-1197.
   Link: https://doi.org/10.1126/science.1185231
   Relevance: clustered network structures can facilitate the spread of behavior when reinforcement matters.

4. Watts, D. J., and Strogatz, S. H. (1998). `Collective dynamics of 'small-world' networks`. Nature, 393, 440-442.
   Link: https://doi.org/10.1038/30918
   Relevance: supports the use of small-world topology families for diffusion experiments.

5. Barabasi, A.-L., and Albert, R. (1999). `Emergence of scaling in random networks`. Science, 286(5439), 509-512.
   Link: https://doi.org/10.1126/science.286.5439.509
   Relevance: supports hub-dominated topology assumptions and the use of preferential-attachment families.

6. Abrams, D. M., and Strogatz, S. H. (2003). `Modelling the dynamics of language death`. Nature, 424, 900.
   Link: https://doi.org/10.1038/424900a
   Relevance: reduced-state language competition models are standard and defensible when the target is macro competition between language forms.

7. Fujie, R., Aihara, K., and Masuda, N. (2015). `A model of competition among more than two languages`. Journal of Statistical Mechanics: Theory and Experiment, 2015(2), P02010.
   Link: https://doi.org/10.1088/1742-5468/2015/02/P02010
   Relevance: if the thesis later upgrades to multi-variant competition, this line of work is the right theoretical bridge.

## 8. Recommended Defense Wording

You can answer the teacher in the following way:

- `What is group behavior here?`
  `It refers to group-level adoption, imitation, persistence, and correction of a nonstandard spelling behavior around one canonical word.`

- `How many nodes does the simulation use?`
  `The system uses a configurable synthetic network, currently controlled by n_agents. Nodes are not recovered real accounts; they are exposure-writing units used to reproduce aggregate diffusion dynamics.`

- `Is the simulation for one word or a group of words?`
  `One simulation task corresponds to one canonical word together with its selected misspelling set.`

- `Is it one misspelling or multiple misspellings?`
  `Observed data can contain multiple misspelling variants, but the current ABM aggregates them into one nonstandard cluster on the simulation side.`

- `What does a node represent in the diffusion network?`
  `A potential writer or exposure unit in the contact network. Edges encode possible social influence channels.`

- `What is the specific diffusion process?`
  `Nodes transition among unknown, error-cluster, and right states under self-error pressure, local copying, norm pressure, proofreading, forgetting, and relapse.`

## 9. Recommended Next Step

For the current acceptance cycle, the best strategy is:

1. Keep the current aggregated-error model as the official system model.
2. Explicitly state the boundary: `right vs nonstandard cluster`.
3. Use variant-level evidence only as descriptive support.
4. Present multi-variant competition as a natural extension rather than claiming it is already implemented.

That path is more defensible than rushing into a larger state-space upgrade without enough calibration evidence.
