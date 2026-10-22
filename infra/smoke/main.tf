terraform {
  required_version = ">= 1.4.0"
}

resource "terraform_data" "smoke" {
  input = "terrakube-action-pr-feedback"
}

output "smoke" {
  value = terraform_data.smoke.output
}
