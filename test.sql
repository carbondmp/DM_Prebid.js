INSERT INTO prebid_module_category 
    (prebid_module_category_name, requires_consent, is_category_billable, consent_agreement_name) 
VALUES ('Third Party', true, true, 'RtdConsent.v1');


SELECT * FROM prebid_module_account
WHERE status = 'active'
AND billable_type = 'Rev Share'
AND rev_share_percent IS NOT NULL;

ALTER TABLE prebid_modules ADD billable_type ENUM('None', 'Billable Event' , 'Rev Share') NOT NULL DEFAULT 'None' AFTER module_name;

ALTER TABLE prebid_modules ADD rev_share_percent FLOAT DEFAULT NULL AFTER billable_type;

UPDATE prebid_modules
SET billable_type = 'Billable Event'
WHERE is_module_billable = 1;

ALTER TABLE prebid_modules DROP COLUMN is_module_billable;


ALTER TABLE prebid_module_account ADD billable_type ENUM('None', 'Billable Event' , 'Rev Share') NOT NULL DEFAULT 'None' AFTER status;

ALTER TABLE prebid_module_account ADD rev_share_percent FLOAT DEFAULT NULL AFTER billable_type;

UPDATE prebid_module_account
SET billable_type = 'Billable Event'
WHERE prebid_module_id in (
    SELECT prebid_module_id
    FROM prebid_modules
    WHERE billable_type = 'Billable Event'
);

SELECT rev.pmps_rev_id, rev.parameter_values, pw.prebid_module_id, pm.pmc_id, pm.aup_param, pm.billable_type
    FROM prebid_module_parameter_set_revisions rev
    INNER JOIN prebid_module_parameter_set_wrapper pw
        ON rev.pmps_rev_id = pw.pmps_rev_id
    AND rev.parameter_set_id = pw.parameter_set_id
    AND pw.account_id = ?
    AND pw.wrapper_name = ?
        AND pw.wrapper_revision = ?
    INNER JOIN prebid_modules pm
        ON pw.prebid_module_id = pm.prebid_module_id