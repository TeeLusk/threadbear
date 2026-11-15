Feature: The long thread card
  As someone with a thread that has gone on a long time
  I want to be told when its conversation is long, with a way to shorten it
  So replies stay cheap and the agent keeps track of what matters

  Background:
    Given the app is connected to a runner with the demo threads

  # The mock makes a thread long when a message says "mock long thread"
  # (162k tokens, the runner's gentle level) or "mock very long thread"
  # (262k, firm), as the runner's contextNudge levels do. The Swift dump
  # has no "longThread".
  @composer.longthread @swift-pending
  Scenario: A long thread suggests compacting or carrying on in a new thread
    When I open the thread "Morning brief"
    And I send "mock long thread"
    Then the long thread card says "This conversation is long (162k tokens)."
    And the long thread card offers "Compact", "Continue in a new thread" and "Not now"

  @composer.longthread @swift-pending
  Scenario: A very long thread says so more firmly
    When I open the thread "Morning brief"
    And I send "mock very long thread"
    Then the long thread card says "This conversation is very long (262k tokens)."

  @composer.longthread @swift-pending
  Scenario: Compact sends /compact and the card goes once the context is short again
    When I open the thread "Morning brief"
    And I send "mock long thread"
    And I click the long thread card's "Compact"
    Then the transcript shows my message "/compact"
    And the long thread card is gone

  @composer.longthread @swift-pending
  Scenario: Not now hides the card until the thread gets longer still
    When I open the thread "Morning brief"
    And I send "mock long thread"
    And I click the long thread card's "Not now"
    Then the long thread card is gone
    When I send "mock very long thread"
    Then the long thread card says "This conversation is very long (262k tokens)."

  @composer.longthread @swift-pending
  Scenario: Continue in a new thread writes a handoff, then opens where it carried on
    When I open the thread "Morning brief"
    And I send "mock long thread"
    And I click the long thread card's "Continue in a new thread"
    Then the long thread card says "Writing a handoff for the new thread…"
    And the long thread card says "Carried on in “Morning brief (continued)”."
    When I click the long thread card's "Open"
    Then the panel bar's title says "Morning brief (continued)"
