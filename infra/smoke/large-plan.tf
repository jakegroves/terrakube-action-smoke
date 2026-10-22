# Plan-only fixture for checking bounded PR feedback. Never apply this fixture.
resource "terraform_data" "large_plan" {
  count = 3000

  input = count.index
}
