from __future__ import annotations

from typing import Any

from ..providers.llm_bailian import strict_json_completion

PARAMETER_GLOSSARY: dict[str, dict[str, Any]] = {
    "p_self_error": {
        "label": "Self Error Pressure",
        "role": "作者在没有明显社会模仿时，也会自行写错的基础概率。",
        "range": [0.0002, 0.080],
        "low": "自发错拼较弱，错误扩散主要依赖网络传播。",
        "mid": "既有自发错拼，也需要传播复制才能形成明显扩散。",
        "high": "单个作者就容易产生日常拼写偏差，错误可在早期自行冒头。",
    },
    "p_copy_error": {
        "label": "Error Copy Pressure",
        "role": "个体受邻居错拼影响而继续复制错拼的强度。",
        "range": [0.005, 0.700],
        "low": "错误主要停留在局部，扩散链条短。",
        "mid": "错误会被复制，但仍受到规范拼写约束。",
        "high": "错拼具有较强社会传播性，一旦形成热点就容易持续扩散。",
    },
    "p_copy_right": {
        "label": "Right Copy Pressure",
        "role": "个体受邻居正确拼写影响而转向规范写法的强度。",
        "range": [0.020, 0.700],
        "low": "正确拼写的示范效应较弱，纠偏依赖外部机制。",
        "mid": "正确拼写具有正常的社会模仿纠偏能力。",
        "high": "规范写法具备明显的社会自稳能力，局部错误更容易被纠正。",
    },
    "p_proofread": {
        "label": "Proofreading Pressure",
        "role": "外部校对、编辑、教育等纠错机制将错拼纠正为正拼的强度。",
        "range": [0.010, 0.700],
        "low": "系统外部纠偏较弱，错误一旦进入传播链就更难收敛。",
        "mid": "存在常规纠偏机制，但不一定足以压制热点传播。",
        "high": "制度性或平台性纠偏明显，错误难以长期维持高位。",
    },
    "p_forget": {
        "label": "Forgetting Pressure",
        "role": "原本掌握正确拼写的节点重新回到不确定状态的概率。",
        "range": [0.0002, 0.150],
        "low": "一旦形成规范写法记忆，后续较稳定。",
        "mid": "词项注意力下降时，部分人会重新变得模糊。",
        "high": "正确拼写保持性差，长期规范化基础不稳。",
    },
    "p_norm": {
        "label": "Norm Pressure",
        "role": "规范优势本身对错拼进行压制和纠正的力度。",
        "range": [0.010, 0.700],
        "low": "该词的规范优势不强，社会层面的正字标准难以形成压制。",
        "mid": "规范优势存在，但仍需与错误传播竞争。",
        "high": "规范性很强，错拼容易被社会共识快速拉回。",
    },
    "alpha_salience": {
        "label": "Salience Sensitivity",
        "role": "词项热度变化对激活和传播速度的放大系数。",
        "range": [0.30, 2.40],
        "low": "传播速度对词项热度不敏感，更像慢扩散。",
        "mid": "词热度上升会带来正常幅度的传播放大。",
        "high": "一旦词项热度上升，传播会明显加速并放大竞争。",
    },
    "beta_phase": {
        "label": "Phase Shift Gain",
        "role": "传播进入 phase break 之后，错误侧扩散额外增强的幅度。",
        "range": [0.00, 1.20],
        "low": "机制切换后传播状态变化较温和。",
        "mid": "phase break 后错误扩散明显进入新的竞争状态。",
        "high": "phase break 后错误扩散被显著放大，说明中后期存在机制跃迁。",
    },
    "gamma_hub": {
        "label": "Hub Amplification",
        "role": "高连接节点在传播中放大影响力的程度。",
        "range": [0.00, 1.80],
        "low": "网络中心节点和普通节点差异不大，扩散较均匀。",
        "mid": "中心节点会放大传播，但不是唯一主导力量。",
        "high": "少数 hub 会显著主导错误扩散和纠偏路径。",
    },
    "seed_error_frac": {
        "label": "Initial Error Seeds",
        "role": "初始状态中带有错拼的种子节点比例。",
        "range": [0.0, 0.060],
        "low": "模型假设错误从很小的先发群体开始扩散。",
        "mid": "错误在传播早期就有一定基础盘。",
        "high": "错误一开始就拥有较大的早期可见群体。",
    },
    "seed_right_frac": {
        "label": "Initial Right Seeds",
        "role": "初始状态中已掌握正确拼写的种子节点比例。",
        "range": [0.003, 0.120],
        "low": "规范写法在早期并没有明显先发优势。",
        "mid": "正确拼写有一定初始基础。",
        "high": "规范写法从一开始就有较强先发盘面。",
    },
}


def _value_band(name: str, value: float) -> str:
    low, high = PARAMETER_GLOSSARY[name]["range"]
    span = max(high - low, 1e-9)
    ratio = (float(value) - low) / span
    if ratio < 0.33:
        return "low"
    if ratio > 0.67:
        return "high"
    return "mid"


def _format_value(name: str, value: float) -> str:
    if name in {"alpha_salience", "beta_phase", "gamma_hub"}:
        return f"{float(value):.3f}"
    return f"{float(value):.4f}"


def _fallback_chart_guide(summary: dict[str, Any]) -> list[dict[str, str]]:
    phase_year = summary.get("phase_break_year")
    return [
        {
            "key": "fit",
            "title": "Observed vs Simulated",
            "explanation": "左上图用双轴展示拟合结果：蓝线是正确拼写频率，红线是错误拼写频率；实线是观测值，虚线是仿真值。两组线越贴近，说明模型越能重构真实传播轨迹。",
        },
        {
            "key": "share",
            "title": "Error Share",
            "explanation": f"左下图展示错拼占总传播量的比例变化，虚线与实体线之间的差距反映模型对错误扩散占比的刻画偏差。虚线阴影表示重复仿真的波动范围。虚线分界线对应 phase break 年份 {phase_year}。",
        },
        {
            "key": "intervention",
            "title": "Intervention Scenarios",
            "explanation": "右上图从 phase break 之后启动干预，对比 proofreading、norm guard 和 combined control 三种机制对错误扩散曲线的压制效果。曲线越低，表示该策略越能压制错拼传播。",
        },
        {
            "key": "animation",
            "title": "Propagation Animation",
            "explanation": "动图把节点网络扩散、宏观曲线和节点状态组成放在同一时间轴下联动，便于解释错误如何从局部接触扩散到整体群体。",
        },
    ]


def _fit_assessment(summary: dict[str, Any], metrics: dict[str, Any]) -> list[str]:
    fit_regime = str(summary.get("fit_regime") or "").strip().lower()
    fit_regime_label = str(summary.get("fit_regime_label") or "Standard Regime")
    right_r2 = float(((metrics.get("right") or {}).get("r2")) or 0.0)
    error_r2 = float(((metrics.get("error") or {}).get("r2")) or 0.0)
    share_r2 = float(((metrics.get("error_share") or {}).get("r2")) or 0.0)
    error_rmse = float(summary.get("error_rmse") or 0.0)
    share_rmse = float(summary.get("share_rmse") or 0.0)
    error_nrmse = float(summary.get("error_nrmse_peak") or 0.0)
    share_nrmse = float(summary.get("share_nrmse_peak") or 0.0)
    peak_gap = summary.get("error_peak_year_gap")
    if fit_regime == "sparse_signal":
        return [
            f"当前属于 {fit_regime_label}：等级主要看 Right R²={right_r2:.3f}、Error NRMSE={error_nrmse:.3f}、Share NRMSE={share_nrmse:.3f} 与峰值年份差 {peak_gap}。",
            "由于观测错拼信号远弱于规范拼写，error/share 的原始 R² 在这一口径下容易因低方差而失真，所以只作为参考，不单独决定等级。",
            f"参考性的原始指标仍然保留：error R²={error_r2:.3f}、share R²={share_r2:.3f}、error RMSE={error_rmse:.3e}、share RMSE={share_rmse:.3e}。",
        ]
    notes = [
        f"当前属于 {fit_regime_label}：正确拼写轨迹的 R² 为 {right_r2:.3f}，用于衡量模型是否抓住主传播骨架。",
        f"错误拼写轨迹的 R² 为 {error_r2:.3f}，RMSE 为 {error_rmse:.3e}，用于衡量错拼量级与峰值位置是否合理。",
        f"错误占比轨迹的 R² 为 {share_r2:.3f}，RMSE 为 {share_rmse:.3e}，用于判断模型是否正确描述了错拼在总传播中的竞争份额。",
    ]
    return notes


def _fallback_parameter_rows(best_params: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name, meta in PARAMETER_GLOSSARY.items():
        value = float(best_params.get(name) or 0.0)
        band = _value_band(name, value)
        rows.append(
            {
                "name": name,
                "label": meta["label"],
                "value": value,
                "display_value": _format_value(name, value),
                "band": band,
                "role": meta["role"],
                "interpretation": str(meta[band]),
            }
        )
    return rows


def _merge_llm_parameter_notes(
    fallback_rows: list[dict[str, Any]],
    llm_notes: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    by_name = {str(item.get("name") or "").strip(): item for item in (llm_notes or []) if isinstance(item, dict)}
    merged: list[dict[str, Any]] = []
    for row in fallback_rows:
        llm_row = by_name.get(str(row["name"]))
        item = dict(row)
        if llm_row:
            interpretation = str(llm_row.get("interpretation") or "").strip()
            if interpretation:
                item["interpretation"] = interpretation
            implication = str(llm_row.get("implication") or "").strip()
            if implication:
                item["implication"] = implication
        merged.append(item)
    return merged


def explain_simulation_fit(
    word: str,
    summary: dict[str, Any],
    best_params: dict[str, Any],
    metrics: dict[str, Any],
    network_summary: dict[str, Any],
    variant_breakdown: list[dict[str, Any]] | None = None,
    actor_user_id: int | None = None,
) -> dict[str, Any]:
    fallback_rows = _fallback_parameter_rows(best_params)
    scope_label = str(summary.get("variant_scope_label") or "Selected Variant Cluster")
    scope_reason = str(summary.get("variant_scope_reason") or "").strip()
    excluded_count = int(summary.get("excluded_variant_count") or 0)
    excluded_variants = [str(item) for item in (summary.get("excluded_variants") or []) if str(item).strip()]
    scope_sentence = (
        f"本次采用 {scope_label} 口径，自动剔除了 {excluded_count} 个更像正字法竞争项而非稀疏错拼的变体：{', '.join(excluded_variants[:6])}。"
        if excluded_count > 0 and excluded_variants
        else f"本次采用 {scope_label} 口径。"
    )
    if scope_reason:
        scope_sentence = f"{scope_sentence}{scope_reason}"
    fallback = {
        "source": "heuristic",
        "overview": (
            f"{word} 的仿真把正确拼写与由多个错拼变体聚合得到的非规范拼写簇，"
            f"放到同一个带活动权重与阶段切换的网络扩散框架里拟合，用来解释这个词在群体传播中何时进入机制切换，以及非规范拼写为何会持续存在。{scope_sentence}"
        ),
        "fit_assessment": _fit_assessment(summary, metrics),
        "chart_guide": _fallback_chart_guide(summary),
        "parameter_notes": fallback_rows,
        "takeaways": [
            "如果本次采用 typo cluster 口径，说明系统先把强竞争正字法变体剥离，再拟合真正的错拼扩散过程。",
            "如果 p_copy_error 和 gamma_hub 较高，说明错拼更依赖社会复制与中心节点放大，而不是单纯的随机笔误。",
            "如果 p_proofread 与 p_norm 较低，说明仅靠自然规范优势不足以消化已经扩散开的错拼，需要更明确的纠偏机制。",
            "phase break 之后干预曲线分化越明显，说明传播后期的治理策略选择会显著改变最终错误残留量。",
            "如果当前属于 sparse-signal regime，就应把注意力放在峰值误差、尾部误差和峰值年份，而不是只盯着 raw R²。",
        ],
        "llm_error": None,
        "warnings": [],
    }

    prompt = (
        "只返回 JSON，不要输出任何额外文本。"
        "JSON 结构必须是："
        "{\"overview\":\"...\","
        "\"fit_assessment\":[\"...\",\"...\"],"
        "\"chart_guide\":[{\"key\":\"fit\",\"title\":\"...\",\"explanation\":\"...\"}],"
        "\"parameter_notes\":[{\"name\":\"p_self_error\",\"interpretation\":\"...\",\"implication\":\"...\"}],"
        "\"takeaways\":[\"...\",\"...\"]}。"
        "请用中文解释一个错误拼写传播仿真结果，语言要专业、克制、可答辩。"
        f"单词：{word}。"
        f"摘要指标：best_score={summary.get('best_score')}, fit_grade={summary.get('fit_grade')}, fit_regime={summary.get('fit_regime_label')}, fit_protocol={summary.get('fit_protocol')}, right_r2={summary.get('right_r2')}, error_r2={summary.get('error_r2')}, share_r2={summary.get('share_r2')}, error_nrmse_peak={summary.get('error_nrmse_peak')}, share_nrmse_peak={summary.get('share_nrmse_peak')}, phase_break_year={summary.get('phase_break_year')}, best_scenario={summary.get('best_scenario')}。"
        f"信号强度：signal_strength_label={summary.get('signal_strength_label')}, signal_strength_reason={summary.get('signal_strength_reason')}。"
        f"模型口径：unit_of_analysis={summary.get('unit_of_analysis')}, competition_scope={summary.get('competition_scope')}, state_space={summary.get('state_space')}, observed_variant_count={summary.get('observed_variant_count')}, requested_variant_count={summary.get('requested_variant_count')}, excluded_variant_count={summary.get('excluded_variant_count')}, excluded_variants={summary.get('excluded_variants')}, variant_scope_label={summary.get('variant_scope_label')}, variant_scope_reason={summary.get('variant_scope_reason')}, network_semantics={summary.get('network_semantics')}, requested_topology={summary.get('requested_topology')}, selected_topology={summary.get('selected_topology')}, requested_n_agents={summary.get('requested_n_agents')}, effective_n_agents={summary.get('n_agents')}, sparse_agent_floor={summary.get('sparse_agent_floor')}, activity_weight_scheme={summary.get('activity_weight_scheme')}, precision_strategy={summary.get('precision_strategy')}, model_complexity={summary.get('model_complexity')}, parameter_count={summary.get('parameter_count')}。"
        f"网络摘要：avg_degree={network_summary.get('avg_degree')}, clustering={network_summary.get('clustering')}, density={network_summary.get('density')}, activity_gini={network_summary.get('activity_gini')}。"
        f"参数列表：{best_params}。"
        f"高频错拼摘要：{variant_breakdown or []}。"
        "要求："
        "1. 概述说明这个词的传播机制。"
        "2. fit_assessment 用 2 到 4 句评价拟合质量与限制。"
        "3. chart_guide 必须覆盖 fit、share、intervention、animation 四个 key。"
        "4. parameter_notes 必须覆盖所有参数名，并解释该参数在本次结果中的含义。"
        "5. takeaways 给出 2 到 4 条可解释性结论。"
        "6. 不要把当前模型误写成“每个错误变体都被单独仿真”；当前模型仿真的错误侧是聚合后的非规范拼写簇。"
        "6a. 如果 excluded_variant_count 大于 0，要说明系统为什么先剥离强竞争正字法变体，再拟合 typo cluster。"
        "7. 如果 selected_topology 不等于 requested_topology，请说明自动拓扑筛选的意义。"
        "8. 如果 fit_regime 是 sparse-signal，请明确说明为什么 raw R² 只能作为参考，而不能单独决定等级。"
    )
    llm = strict_json_completion(
        prompt,
        actor_user_id=actor_user_id,
        action="LLM_SIMULATION_EXPLAIN",
        audit_meta={"word": word, "points": summary.get("points"), "topology": summary.get("topology")},
        temperature=0.2,
        timeout_seconds=45,
    )
    parsed = llm.get("parsed")
    if not isinstance(parsed, dict):
        return {
            **fallback,
            "warnings": list(dict.fromkeys([*fallback["warnings"], *(llm.get("warnings") or [])])),
            "llm_error": llm.get("llm_error"),
        }

    chart_guide = parsed.get("chart_guide")
    if not isinstance(chart_guide, list) or not chart_guide:
        chart_guide = fallback["chart_guide"]
    fit_assessment = parsed.get("fit_assessment")
    if not isinstance(fit_assessment, list) or not fit_assessment:
        fit_assessment = fallback["fit_assessment"]
    takeaways = parsed.get("takeaways")
    if not isinstance(takeaways, list) or not takeaways:
        takeaways = fallback["takeaways"]

    return {
        "source": "llm",
        "overview": str(parsed.get("overview") or fallback["overview"]).strip(),
        "fit_assessment": [str(item).strip() for item in fit_assessment if str(item).strip()],
        "chart_guide": [
            {
                "key": str(item.get("key") or ""),
                "title": str(item.get("title") or ""),
                "explanation": str(item.get("explanation") or ""),
            }
            for item in chart_guide
            if isinstance(item, dict)
        ]
        or fallback["chart_guide"],
        "parameter_notes": _merge_llm_parameter_notes(
            fallback_rows,
            parsed.get("parameter_notes") if isinstance(parsed.get("parameter_notes"), list) else None,
        ),
        "takeaways": [str(item).strip() for item in takeaways if str(item).strip()],
        "llm_error": llm.get("llm_error"),
        "warnings": list(dict.fromkeys([*(llm.get("warnings") or [])])),
    }
