# MPE Frequency Sweep Analyser

An independent Streamlit tool for analysing frequency-sweep workbook data, including resistance, reactance, impedance and X/R visualisation. It includes interactive case selection and chart export.

## Input files

Upload an Excel workbook containing R1 and X1 worksheets. R0 and X0 worksheets are optional. The analyser expects frequency values in the first column and case data in the remaining columns. The X/R gradient is visual only and does not alter the plotted data.

The app also looks for FS_sweep.xlsx beside fs_sweep_app_spline.py when no upload is selected. No sample workbook is included in this public repository.

## Run locally

Create the dedicated Conda environment and start the app from this repository directory:

    conda env create -f environment.yml
    conda activate mpe-frequency-sweep
    streamlit run fs_sweep_app_spline.py

Run Python tests with pytest. The browser-side contract checks use Node.js:

    node --test tests/test_browser_contracts.js

## Review and limitations

This tool visualises supplied workbook values and does not validate a network model. Check workbook units and case labels, and have a competent engineer review the results before engineering use.

## Deployment

Deploy fs_sweep_app_spline.py from the main branch of this repository in Streamlit Community Cloud. Dependencies are listed in requirements.txt.