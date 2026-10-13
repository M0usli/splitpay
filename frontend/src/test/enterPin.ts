import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** The PIN the component tests pay with. */
export const TEST_PIN = "4826";

/** Tap the digits of a PIN on the pad. Waits for the pad to appear first. */
export async function enterPin(pin: string = TEST_PIN) {
  for (const digit of pin) {
    await userEvent.click(await screen.findByRole("button", { name: digit }));
  }
}
