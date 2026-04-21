# Requirements Document

## Introduction

This feature adds two top-level shell scripts — `app-up.sh` and `app-down.sh` — that wrap the existing Terraform configuration in `terraform/` to provide a predictable, single-command deployment and teardown experience for the DevOps Agent Demo Store.

The primary goal is safety: the teardown path must leave zero AWS resources behind in the configured region that are tagged with `Project=devops-demo` and `ManagedBy=terraform`, and it must never delete any resource that lacks both of those tags. The secondary goal is ergonomics: a user who has cloned the repo and configured AWS credentials should be able to run one command to launch the stack and one command to remove it, with clear pre-flight checks and actionable error messages.

Both scripts are non-interactive by default. `app-down.sh` requires an explicit `--yes` flag to run; this makes the teardown scriptable from CI or other automation without risking an accidental destroy from a stray keystroke.

## Glossary

- **App_Up_Script**: The executable shell script at `app-up.sh` in the repository root, responsible for running pre-flight checks and invoking `terraform apply` against the `terraform/` directory.
- **App_Down_Script**: The executable shell script at `app-down.sh` in the repository root, responsible for emptying the S3 frontend bucket, running `terraform destroy`, and running an orphan-sweep validation.
- **Project_Tag**: The AWS resource tag with key `Project` and value `devops-demo`. Every resource created by the Terraform configuration in `terraform/` is automatically stamped with this tag via the provider's `default_tags` block.
- **ManagedBy_Tag**: The AWS resource tag with key `ManagedBy` and value `terraform`. Every resource created by the Terraform configuration is automatically stamped with this tag.
- **Target_Resource**: Any AWS resource in the configured region (from `aws_region` in `terraform.tfvars`) that carries BOTH the Project_Tag AND the ManagedBy_Tag.
- **Orphan_Sweep**: The post-destroy validation step that queries the AWS Resource Groups Tagging API for Target_Resources and reports any that still exist.
- **Terraform_State**: The `terraform.tfstate` file (local backend) or remote state backend configured in `terraform/`.
- **AWS_Account**: The AWS account identified by `STS GetCallerIdentity`. The expected account for this project is `684394110906`.
- **Configured_Region**: The AWS region read from `terraform/terraform.tfvars` (key `aws_region`), defaulting to `us-east-1`.
- **Tfvars_File**: The file at `terraform/terraform.tfvars`, which supplies values for variables declared in `terraform/variables.tf`.
- **Tfvars_Example_File**: The template file at `terraform/terraform.tfvars.example`.
- **S3_Frontend_Bucket**: The S3 bucket created by `terraform/s3-frontend.tf` for static frontend hosting, which must be emptied of all objects (and object versions, if versioning is enabled) before `terraform destroy` can succeed.
- **Pre_Flight_Check**: A synchronous verification step that runs before any mutating AWS operation, such as checking AWS credential validity or tool installation.

## Requirements

### Requirement 1: One-Command Launch

**User Story:** As a developer with a freshly cloned repo, I want to run a single command that deploys the full AWS stack, so that I do not have to memorize the Terraform sub-commands or tfvars setup dance.

#### Acceptance Criteria

1. THE App_Up_Script SHALL be an executable shell script located at `app-up.sh` in the repository root.
2. WHEN the App_Up_Script is invoked without arguments, THE App_Up_Script SHALL run all Pre_Flight_Checks before invoking Terraform.
3. WHEN all Pre_Flight_Checks pass, THE App_Up_Script SHALL run `terraform init` in the `terraform/` directory if `terraform/.terraform` does not already exist.
4. WHEN initialization is complete, THE App_Up_Script SHALL run `terraform apply -auto-approve` in the `terraform/` directory.
5. WHEN `terraform apply` exits successfully, THE App_Up_Script SHALL print the Terraform outputs `alb_dns_name`, `s3_website_url`, and `sns_topic_arn` to standard output, each on its own labeled line.
6. WHEN `terraform apply` exits with a non-zero status, THE App_Up_Script SHALL exit with the same non-zero status and print the failing command to standard error.

### Requirement 2: Launch Pre-Flight Checks

**User Story:** As a developer, I want the launch script to fail fast with a clear error message when prerequisites are missing, so that I do not get partway through a deploy before discovering a missing tool or credential.

#### Acceptance Criteria

1. WHEN the App_Up_Script starts, THE App_Up_Script SHALL verify that the `aws` CLI is installed and on `PATH`.
2. IF the `aws` CLI is not installed, THEN THE App_Up_Script SHALL exit with status 1 and print `ERROR: aws CLI is not installed. Install it from https://aws.amazon.com/cli/ and re-run.` to standard error.
3. WHEN the App_Up_Script starts, THE App_Up_Script SHALL verify that the `terraform` CLI is installed and on `PATH`.
4. IF the `terraform` CLI is not installed AND the host operating system is Darwin AND Homebrew is installed, THEN THE App_Up_Script SHALL install Terraform by running `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`.
5. IF the `terraform` CLI is not installed AND either the host operating system is not Darwin OR Homebrew is not installed, THEN THE App_Up_Script SHALL exit with status 1 and print `ERROR: terraform CLI is not installed and cannot be auto-installed on this platform. Install it from https://developer.hashicorp.com/terraform/downloads and re-run.` to standard error.
6. WHEN the App_Up_Script starts, THE App_Up_Script SHALL verify AWS credentials by running `aws sts get-caller-identity` and checking that the exit status is zero.
7. IF `aws sts get-caller-identity` returns a non-zero exit status, THEN THE App_Up_Script SHALL exit with status 1 and print `ERROR: AWS credentials are not configured or are invalid. Run 'aws configure' or set AWS_PROFILE and re-run.` to standard error.
8. WHEN the App_Up_Script starts, THE App_Up_Script SHALL verify that the resolved AWS account ID from `aws sts get-caller-identity` matches `684394110906`.
9. IF the resolved AWS account ID does not match `684394110906`, THEN THE App_Up_Script SHALL exit with status 1 and print `ERROR: Expected AWS account 684394110906 but got <actual>. Check your AWS_PROFILE.` to standard error, where `<actual>` is the account ID that was returned.
10. WHEN the App_Up_Script starts AND `terraform/terraform.tfvars` does not exist AND `terraform/terraform.tfvars.example` exists, THE App_Up_Script SHALL copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` and print `Copied terraform/terraform.tfvars.example to terraform/terraform.tfvars. Edit it if you need non-default values.` to standard output.

### Requirement 3: One-Command Teardown with Explicit Confirmation

**User Story:** As a developer finishing a demo, I want to run a single non-interactive command that tears down every AWS resource this project created, so that I stop accruing costs immediately and can script the teardown from CI.

#### Acceptance Criteria

1. THE App_Down_Script SHALL be an executable shell script located at `app-down.sh` in the repository root.
2. WHEN the App_Down_Script is invoked without a `--yes` argument, THE App_Down_Script SHALL exit with status 2 and print `ERROR: app-down.sh requires --yes to run. This will destroy all AWS resources tagged Project=devops-demo in account 684394110906. Usage: ./app-down.sh --yes` to standard error.
3. WHEN the App_Down_Script is invoked with the `--yes` argument, THE App_Down_Script SHALL proceed without any interactive prompt.
4. WHEN the App_Down_Script proceeds, THE App_Down_Script SHALL run all Pre_Flight_Checks specified in Requirement 4 before performing any destructive action.

### Requirement 4: Teardown Pre-Flight Checks

**User Story:** As a developer, I want the teardown script to verify credentials and account before deleting anything, so that I cannot accidentally delete resources from the wrong AWS account.

#### Acceptance Criteria

1. WHEN the App_Down_Script starts its Pre_Flight_Checks, THE App_Down_Script SHALL verify that the `aws` CLI is installed and on `PATH`.
2. IF the `aws` CLI is not installed, THEN THE App_Down_Script SHALL exit with status 1 and print `ERROR: aws CLI is not installed.` to standard error.
3. WHEN the App_Down_Script starts its Pre_Flight_Checks, THE App_Down_Script SHALL verify that the `terraform` CLI is installed and on `PATH`.
4. IF the `terraform` CLI is not installed, THEN THE App_Down_Script SHALL exit with status 1 and print `ERROR: terraform CLI is not installed.` to standard error.
5. WHEN the App_Down_Script starts its Pre_Flight_Checks, THE App_Down_Script SHALL verify AWS credentials by running `aws sts get-caller-identity` and checking that the exit status is zero.
6. IF `aws sts get-caller-identity` returns a non-zero exit status, THEN THE App_Down_Script SHALL exit with status 1 and print `ERROR: AWS credentials are not configured or are invalid.` to standard error.
7. WHEN the App_Down_Script starts its Pre_Flight_Checks, THE App_Down_Script SHALL verify that the resolved AWS account ID from `aws sts get-caller-identity` matches `684394110906`.
8. IF the resolved AWS account ID does not match `684394110906`, THEN THE App_Down_Script SHALL exit with status 1 and print `ERROR: Expected AWS account 684394110906 but got <actual>. Refusing to destroy resources in the wrong account.` to standard error, where `<actual>` is the account ID that was returned.

### Requirement 5: S3 Frontend Bucket Emptying

**User Story:** As a developer, I want the teardown to handle the non-empty S3 bucket case automatically, so that I do not have to manually empty the bucket before `terraform destroy` will succeed.

#### Acceptance Criteria

1. WHEN the App_Down_Script has passed Pre_Flight_Checks AND before invoking `terraform destroy`, THE App_Down_Script SHALL identify the S3_Frontend_Bucket name by running `terraform output -raw s3_bucket_name` in the `terraform/` directory, falling back to parsing `terraform state show` for the `aws_s3_bucket.frontend` resource if the output is not defined.
2. IF the S3_Frontend_Bucket name cannot be determined from Terraform_State, THEN THE App_Down_Script SHALL skip S3 emptying and proceed to `terraform destroy`, printing `No S3 frontend bucket found in Terraform state; skipping bucket emptying.` to standard output.
3. WHEN the S3_Frontend_Bucket name is known, THE App_Down_Script SHALL delete all current objects by running `aws s3 rm s3://<bucket>/ --recursive` in the Configured_Region.
4. WHEN the S3_Frontend_Bucket name is known AND bucket versioning is enabled, THE App_Down_Script SHALL delete all non-current object versions and delete markers by listing them via `aws s3api list-object-versions` and deleting them via `aws s3api delete-objects` in batches of up to 1000 per request.
5. IF S3 emptying returns a non-zero exit status for any reason other than the bucket not existing, THEN THE App_Down_Script SHALL exit with status 1 and print the failing AWS CLI command and its error output to standard error.

### Requirement 6: Terraform Destroy Execution

**User Story:** As a developer, I want the teardown to run `terraform destroy` non-interactively using the authoritative Terraform_State, so that every resource Terraform created is deleted in dependency order.

#### Acceptance Criteria

1. WHEN the App_Down_Script has completed S3 emptying, THE App_Down_Script SHALL run `terraform destroy -auto-approve` in the `terraform/` directory.
2. WHEN `terraform destroy` exits with a non-zero status, THE App_Down_Script SHALL continue to the Orphan_Sweep step rather than exiting immediately, and SHALL record the non-zero status for use in the final exit code.
3. WHEN `terraform destroy` exits with status zero, THE App_Down_Script SHALL record success for use in the final exit code.
4. WHEN Terraform_State does not exist in the `terraform/` directory, THE App_Down_Script SHALL skip `terraform destroy` and proceed directly to the Orphan_Sweep step, printing `No Terraform state found; skipping terraform destroy and running orphan sweep only.` to standard output.

### Requirement 7: Orphan Sweep Validation

**User Story:** As a developer, I want the teardown to verify that zero tagged resources remain after destroy, so that I have high confidence that I am not leaking AWS spend from orphaned resources.

#### Acceptance Criteria

1. WHEN the App_Down_Script has completed `terraform destroy` or skipped it, THE App_Down_Script SHALL run the Orphan_Sweep by calling `aws resourcegroupstaggingapi get-resources --region <Configured_Region> --tag-filters Key=Project,Values=devops-demo Key=ManagedBy,Values=terraform`.
2. WHEN the Orphan_Sweep response lists zero resources, THE App_Down_Script SHALL print `Orphan sweep: 0 resources remain. Teardown complete.` to standard output.
3. WHEN the Orphan_Sweep response lists one or more resources, THE App_Down_Script SHALL print `Orphan sweep: <N> tagged resources still exist:` to standard error, followed by each resource ARN on its own line, where `<N>` is the count of remaining resources.
4. WHEN the Orphan_Sweep response lists one or more resources, THE App_Down_Script SHALL exit with status 3.
5. WHEN the Orphan_Sweep response lists zero resources AND the earlier `terraform destroy` exited with status zero, THE App_Down_Script SHALL exit with status 0.
6. WHEN the Orphan_Sweep response lists zero resources AND the earlier `terraform destroy` exited with a non-zero status, THE App_Down_Script SHALL exit with status 0 and print `terraform destroy reported errors but orphan sweep is clean; treating teardown as successful.` to standard output.

### Requirement 8: Tag Scope Safety

**User Story:** As a developer sharing an AWS account with other projects, I want absolute certainty that the teardown only touches this project's resources, so that my cleanup never damages another team's workload.

#### Acceptance Criteria

1. THE App_Down_Script SHALL NOT invoke any AWS delete operation whose target resource does not carry both the Project_Tag and the ManagedBy_Tag, with the sole exception of deleting objects inside the S3_Frontend_Bucket (which is itself a Target_Resource).
2. THE App_Down_Script SHALL NOT invoke any `aws ec2 terminate-instances`, `aws rds delete-db-instance`, `aws ec2 delete-volume`, or similar service-specific delete command directly; all resource deletion SHALL be performed either by `terraform destroy` or, for S3 bucket contents, by the S3 emptying step in Requirement 5.
3. THE Orphan_Sweep SHALL filter on both Project_Tag and ManagedBy_Tag simultaneously; a resource carrying only one of the two tags SHALL NOT be reported as an orphan.

### Requirement 9: Idempotency

**User Story:** As a developer recovering from a partial failure, I want to safely re-run either script, so that I can retry without worrying about duplicate resources or crashes.

#### Acceptance Criteria

1. WHEN the App_Up_Script is re-invoked after a successful prior run AND no `terraform/*.tf` files have changed, THE App_Up_Script SHALL exit with status 0 and print `No infrastructure changes required.` to standard output.
2. WHEN the App_Down_Script is re-invoked with `--yes` after a successful prior teardown, THE App_Down_Script SHALL exit with status 0 and print `Orphan sweep: 0 resources remain. Teardown complete.` to standard output.
3. WHEN the App_Down_Script is re-invoked with `--yes` after a partially failed prior teardown, THE App_Down_Script SHALL re-attempt S3 emptying, `terraform destroy`, and Orphan_Sweep in order, and SHALL exit with the status defined by Requirement 7.

### Requirement 10: Tag Filter Parsing

**User Story:** As a developer maintaining this script, I want the tag-filter construction and the orphan-sweep response parsing to be isolated, pure, and unit-testable, so that the safety-critical tag logic can be verified with property-based tests without making AWS calls.

#### Acceptance Criteria

1. THE App_Down_Script SHALL source a helper script at `scripts/lib/tag-filter.sh` that exposes a shell function `build_tag_filter_args` which takes no arguments and writes the exact CLI arguments needed to filter by Project_Tag and ManagedBy_Tag to standard output.
2. THE App_Down_Script SHALL source a helper script at `scripts/lib/orphan-parse.sh` that exposes a shell function `parse_orphan_arns` which reads a `aws resourcegroupstaggingapi get-resources` JSON response on standard input and writes one resource ARN per line to standard output.
3. FOR ALL valid `aws resourcegroupstaggingapi get-resources` JSON responses, calling `parse_orphan_arns` followed by counting lines SHALL yield a count equal to the length of the `ResourceTagMappingList` array in the input JSON (round-trip parsing property).
4. THE helper scripts in `scripts/lib/` SHALL be sourceable in isolation without executing any AWS CLI or Terraform command at source-time.

### Requirement 11: Automated Testing

**User Story:** As a developer, I want the pure logic inside the lifecycle scripts to be covered by tests, so that future edits do not silently break the safety-critical tag-scope and pre-flight-check behavior.

#### Acceptance Criteria

1. THE repository SHALL include a test file at `scripts/lib/tag-filter.test.ts` that verifies `build_tag_filter_args` emits the exact string `--tag-filters Key=Project,Values=devops-demo Key=ManagedBy,Values=terraform`.
2. THE repository SHALL include a test file at `scripts/lib/orphan-parse.test.ts` that verifies `parse_orphan_arns` for three cases: empty `ResourceTagMappingList`, single-element list, and multi-element list.
3. THE repository SHALL include a property-based test in `scripts/lib/orphan-parse.property.test.ts` using `fast-check` that verifies the round-trip property from Requirement 10.3 across at least 100 generated inputs.
4. THE test files SHALL be runnable via the existing `npm test -- --run` command configured in the repository root `package.json`.

### Requirement 12: Documentation Update

**User Story:** As a new developer onboarding to the project, I want the README to show the one-command launch and teardown flow, so that I do not have to read the Terraform docs before my first deploy.

#### Acceptance Criteria

1. THE repository root `README.md` SHALL include a section titled `## AWS Deployment (Scripted)` that shows the `./app-up.sh` and `./app-down.sh --yes` commands as the primary deployment path.
2. THE existing `## AWS Deployment (Terraform)` section SHALL be retained as an `## AWS Deployment (Manual Terraform)` subsection for users who prefer direct Terraform control.
3. THE `## AWS Deployment (Scripted)` section SHALL state the exact AWS account ID (`684394110906`) that the scripts expect, and SHALL state that `app-down.sh` requires the `--yes` flag.
