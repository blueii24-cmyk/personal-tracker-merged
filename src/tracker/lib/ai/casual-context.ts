import type { TrackerService } from '@/tracker/lib/api/tracker-service';
import type { UserSettings } from '@/tracker/types/domain';

/** Share only aggregates relevant to the current question, never records, notes or account identity. */
export async function casualContext(service: TrackerService, question: string, settings: UserSettings): Promise<string> {
  const weight = /\b(weight|weigh|bulking|bulk|progress)\b/i.test(question);
  const nutrition = /\b(calorie|calories|protein|nutrition|eating|bulking|bulk|progress)\b/i.test(question);
  const budget = /\b(budget|spend|spending|expense|expenses|money)\b/i.test(question);
  if (!weight && !nutrition && !budget) return 'No tracker summary was requested or supplied.';
  const summary = await service.getDashboardSummary();
  const lines = [`Summary generated ${summary.generatedAt}; date ${summary.today}, timezone ${settings.timezone}.`];
  if (weight) {
    const w = summary.weight;
    lines.push(w.latest ? `Latest weight: ${w.latest.weightKg} kg recorded ${w.latest.recordedAt}; previous: ${w.previous ? `${w.previous.weightKg} kg at ${w.previous.recordedAt}` : 'unavailable'}; target: ${settings.targetWeightKg == null ? 'not set' : `${settings.targetWeightKg} kg`}.` : 'No weight readings are available.');
  }
  if (nutrition) {
    const n = summary.nutritionToday;
    lines.push(`Today: ${n.mealCount} meals; known calories ${n.caloriesKcal} kcal, known protein ${n.proteinG} g; ${n.unknownCalorieItems} items have unknown calories, ${n.unknownProteinItems} have unknown protein; estimates present: ${n.hasEstimates}. Targets: calories ${settings.dailyCalorieTarget ?? 'not set'}, protein ${settings.dailyProteinTargetG ?? 'not set'}. These are not multi-day trends.`);
  }
  if (budget) lines.push(`Current month ${summary.budget.monthKey}: recorded expenses INR ${summary.budget.expenses}, recorded income INR ${summary.budget.income}, budget ${summary.budget.monthlyBudget ?? 'not set'}.`);
  return lines.join('\n');
}
