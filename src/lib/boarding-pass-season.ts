/** WSDOT's daily-operation season: Mother's Day through Indigenous Peoples' Day. */
export function isBoardingPassSeason(year: number, month: number, day: number): boolean {
  // Both holidays are the second occurrence of their weekday in the month.
  const mothersDay = 8 + (7 - new Date(Date.UTC(year, 4, 1)).getUTCDay()) % 7;
  const indigenousPeoplesDay = 8 + (1 - new Date(Date.UTC(year, 9, 1)).getUTCDay() + 7) % 7;
  return (month === 5 && day >= mothersDay) ||
    (month > 5 && month < 10) ||
    (month === 10 && day <= indigenousPeoplesDay);
}
