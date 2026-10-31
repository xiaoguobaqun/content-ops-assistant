// 调用 submit 前即跨越可能提交边界；此后任何异常都只能回查，不能自动重放。
export async function submitDyOnce({ submit, confirm, reportUnknown }) {
  try {
    await submit();
    return await confirm();
  } catch (error) {
    return await reportUnknown({
      status: true,
      publishAbnormal: true,
      outcome: "submission_unknown",
      needsAttention: true,
      draftEvidence: error.evidence || null,
      message: `提交后结果待核实，请勿重发：${String(error.message || error).slice(0, 160)}`,
    });
  }
}
